# blitz-quick: 二进制 Bridge 方案

在 **QuickJS**（经 `rquickjs`）里跑 **SolidJS**，把它的反应式 DOM 变更编码成二进制帧，
在每个 `requestAnimationFrame` 边界一次性 flush 给 **blitz-dom**，由 Rust 侧解码并应用到
`BaseDocument` 上、再由 Blitz 布局/渲染。

## 1. 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│  QuickJS  (rquickjs Runtime + Context)                      │
│                                                             │
│   solid-js  ──createRenderer──▶  binaryRenderer.js          │
│   (反应式内核)                    │                          │
│                                   ▼  写入 per-tick 二进制缓冲  │
│                                Uint8Array (writer)           │
│                                   │                          │
│   requestAnimationFrame(cb) ──▶  rAF 队列                    │
│                                                             │
│   __tick()  ── 跑完 rAF 队列 ──▶ __bridge_flush(bytes)       │
└──────────────────────────┬──────────────────────────────────┘
                           │  一帧 = 一段连续 bytes（零拷贝出 QuickJS）
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Rust host                                                  │
│   1. decode  bytes  -> Vec<Op>      (protocol.rs)           │
│   2. apply   Ops    -> DocumentMutator (applier.rs)         │
│        维护  solidId(u32) -> blitzNodeId(usize) 映射          │
│   3. doc.resolve() / 布局 / 渲染 (blitz)                     │
│   4. 事件回流: __dispatchEvent(id, type) -> JS              │
└─────────────────────────────────────────────────────────────┘
```

关键点：**SolidJS 的反应式更新是同步发生的**（信号变更即触发 effect），但 DOM 变更并不
直接落盘——renderer 把它们压进缓冲。**只有 `requestAnimationFrame` 触发时**，缓冲才被
编码成一帧发给 Rust。这样：

- 跨 QuickJS↔Rust 边界的调用从「每个 DOM op 一次」降到「每帧一次」，把成百上千次
  `createElement/setAttribute` 压成一次 `__bridge_flush`。
- 帧内 ops 顺序就是 Solid reconciler 的产出顺序，Rust 侧按序 apply 即可，无需二次 diff。
- Rust 侧拿到的就是一段 `&[u8]`，纯 memcpy 出 TypedArray 后解码，无 JSON、无字符串解析。

## 2. 二进制线路格式

所有整数小端序。`u32` 为 Solid 侧虚拟节点 id（`0` 保留为「无/append 哨兵」）。
字符串 = `[len: u16][utf8 bytes]`（u16 上限 64 KiB/串，足够 DOM 文本/属性）。

### 帧头
```
[seq:   u32]   单调递增帧序号，便于对账/丢帧检测
[count:  u16]  本帧 op 数量
```

### Op 表

| op | 名称              | 操作数                                                  |
|----|-------------------|--------------------------------------------------------|
|01  | CreateElement     | `id u32, tag str, nAttr u16, (name str, val str)*`     |
|02  | CreateText        | `id u32, text str`                                     |
|03  | CreateComment     | `id u32, text str`                                     |
|04  | AppendChild       | `parent u32, child u32`                                |
|05  | InsertBefore      | `parent u32, child u32, ref u32`  (ref==0 ⇒ append)   |
|06  | RemoveChild       | `parent u32, child u32`                                |
|07  | ReplaceNode       | `parent u32, oldId u32, newId u32`                     |
|08  | SetText           | `id u32, text str`                                     |
|09  | SetAttribute      | `id u32, name str, value str`                          |
|0A  | RemoveAttribute   | `id u32, name str`                                     |
|0B  | SetStyle          | `id u32, prop str, value str`                          |
|0C  | RemoveStyle       | `id u32, prop str`                                     |
|0D  | AddEventListener  | `id u32, eventType u8`                                 |
|0E  | RemoveEventListener| `id u32, eventType u8`                                |
|0F  | SetClassName      | `id u32, value str`   （高频，专设 opcode）              |
|10  | FrameEnd          | 无操作哨兵（可选，用于对齐/调试）                         |

`eventType` 枚举：`1=click 2=input 3=submit 4=keydown 5=change 6=scroll ...`。

> 设计取舍：用定长 opcode + 长度前缀串，而不是 varint。解码器是一个 `Cursor<&[u8]>`，
> 单次线性扫描、无分支预测恶化、无分配（Op 用借用切片引用原 buffer 中的串，apply 时再转
> `String` 喂给 blitz）。比 varint 略胖但解码器极简、可向量化。

## 3. rAF 驱动循环

QuickJS 没有渲染器，`requestAnimationFrame` 由宿主提供。JS 侧只维护一个回调队列：

```js
const rafQueue = [];
function requestAnimationFrame(cb) { rafQueue.push(cb); return rafQueue.length; }
```

Rust 主循环每帧（真实场景接 Blitz shell 的 vsync；原型里用定时节拍）调用 JS 入口 `__tick()`：

```js
function __tick() {
  const q = rafQueue.splice(0);          // 取出本帧回调
  for (const cb of q) cb(performance.now());
  if (writer.cursor > 0) {               // 有变更才 flush
    __bridge_flush(writer.bytes.subarray(0, writer.cursor));
    writer.cursor = 0;
  }
}
```

`__bridge_flush` 是 Rust 注入的宿主函数，签名 `fn(TypedArray<u8>)`，把 bytes 拷到
`Rc<RefCell<Vec<u8>>>`。Rust 拿到后 `protocol::decode_frame` → `applier::apply_frame`。
随后 Solid 的下一个 microtask 批次要等下一次 `__tick`——天然帧对齐。

## 4. SolidJS 集成

Solid 的 [universal renderer](https://www.solidjs.com/guides/server#custom-renderer) 通过
`solid-js/web` 的 `createRenderer(opts)` 暴露一组钩子。`renderer.js` 实现这组钩子，
把每个调用翻译成上述 opcode 写进缓冲，节点用 `{ id: u32 }` 句柄表示：

```js
import { createRenderer } from "solid-js/web";
let _id = 1;
const elms = new Map();                 // id -> 句柄（存标签/类型，便于 setProperty 路由）

function node(id){ return { id }; }

export const renderer = createRenderer({
  createElement(tag)  { const id=_id++; emit(OP.CreateElement, id, tag, 0); const n=node(id); elms.set(id,tag); return n; },
  createText(value)   { const id=_id++; emit(OP.CreateText, id, value); return node(id); },
  replaceText(node,v) { emit(OP.SetText, node.id, v); },
  insertNode(parent,node,anchor){
    if (anchor==null) emit(OP.AppendChild, parent.id, node.id);
    else emit(OP.InsertBefore, parent.id, node.id, anchor.id);
  },
  removeNode(parent,node){ emit(OP.RemoveChild, parent.id, node.id); },
  setProperty(node,name,value){
    if (name==="class"||name==="className") emit(OP.SetClassName, node.id, String(value));
    else if (name==="style"&&typeof value==="object") { for(const k in value) emit(OP.SetStyle,node.id,k,value[k]); }
    else if (name==="textContent") emit(OP.SetText,node.id,String(value));
    else if (value==null) emit(OP.RemoveAttribute,node.id,name);
    else emit(OP.SetAttribute,node.id,name,String(value));
  },
  getParentNode(n){ /* 仅 list reconciliation 需要，用 parent 字段回填 */ },
  getFirstChild(n){...}, getNextSibling(n){...},
});
export const render = renderer.render;
```

> Solid 的 list diff 需要 `getParentNode/FirstChild/NextSibling`。原型里节点句柄额外存
> `parent/firstChild/nextSibling`，在 `insertNode/removeNode` 时维护，供 reconciler 遍历。
> 真实 DOM 不存在，这些关系纯靠 JS 句柄侧维护——这正是「离屏 DOM reconciler」的标准做法。

替换 Solid：把 `solid-js` 的打包产物（ESM）通过 rquickjs 的 module loader 加载，
`renderer.js` 不变，应用代码（`createSignal`/JSX/`render(() => <App/>, root)`）原样跑。
**root** 是 Rust 注入的根节点 id（见下）。

## 5. 根挂载点与 id 映射

Rust 侧直接用 `BaseDocument::new(..)` 建空文档（初始仅一个 Document 节点，id=0），
再用 `DocumentMutator` 手搭 `html > body > div#root`——**不经过 blitz-html 的 HTML
解析器**。这样既避免 html5ever 的 parse-error 噪音，也去掉 blitz-html 这条直接依赖
（`DocumentMutator` 本身就能 `create_element` / `append_children`）。记下 `#root` 的
blitz node id 作为顶层 parent。这个 blitz id 通过 JS 全局 `__ROOT_ID`（u32=1）告诉 Solid。
Rust 维护 `HashMap<u32, usize>`：Solid 虚拟 id → blitz slab id。
`CreateElement` 时 `mutator.create_element(...)` 返回 blitz id，存进 map；
`AppendChild` 等通过查 map 拿到双方 id 调 `mutator.append_children`。

## 6. 事件回流

`AddEventListener` op 让 Rust 记下「某 solidId 关心某事件」。blitz 命中测试得到点击的
blitz node → 反查 solidId → 调 `__dispatchEvent(solidId, eventType, payload)`。JS 侧
`renderer` 维护 `id -> handler`，调用后 Solid 反应式更新 → 下一帧 flush 新 ops。
（事件 payload 用紧凑二进制：`type u8, target u32, key u16, mouseX i16, mouseY i16, ...`，
本设计先实现 click/input 的最小子集。）

## 7. 为什么是「每帧一帧」而非每 op

- **吞吐**：Solid 一次状态变更可能级联产生几十~几百个 op。逐个跨边界调用，rquickjs 的
  参数转换 + 锁开销会主导成本。压成一帧后边界穿越次数 = 帧率（60/s）。
- **对齐**：blitz 的布局/重绘本就是帧节奏。把 DOM 变更与渲染同步到 rAF，避免中间态被
  渲染，也避免一帧内多次 `resolve()`。
- **可批量校验**：整帧先解码再 apply，可在 apply 前做完整性校验（id 是否已创建、
  parent 是否存在），出错整帧丢弃而不留下半改的 DOM。

## 8. 模块划分

| 文件              | 职责                                                |
|-------------------|-----------------------------------------------------|
| `src/protocol.rs` | opcode 常量、`Op` 枚举、`encode_frame`/`decode_frame`|
| `src/applier.rs`  | `Applier`：持 `HtmlDocument` + id map，`apply_frame` |
| `src/jsrt.rs`     | rquickjs Runtime/Context，注入 `__bridge_flush`/`requestAnimationFrame`/`__tick`，加载 `renderer.js`+app |
| `src/renderer.js` | Solid `createRenderer` 适配器（`include_str!` 嵌入）|
| `src/app.js`      | demo 反应式应用（`include_str!` 嵌入）              |
| `crates/blitz-quick-desktop/src/main.rs` | 桌面驱动：建文档 → 起 JS → 运行窗口或截图 |

## 9. 原型范围

本仓库实现可编译运行的原型：`renderer.js` 实现 Solid 的 `createRenderer` 接口（可直接
对接真实 `solid-js/web`），`app.js` 用最小反应式内核（`createSignal`/`createEffect`，
语义对齐 Solid）驱动一个计数器 + 列表，证明端到端：

JS 反应式更新 → 二进制帧 → Rust 解码 → blitz-dom 树变更（`print_tree` 可见）。

真实 SolidJS bundle 接入只需：启用 rquickjs `loader` feature，把 `solid-js` 产物放进
module resolver，`renderer.js` 的 `import { createRenderer } from "solid-js/web"` 即生效，
应用代码无需改动。
