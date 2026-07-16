use crate::protocol::{event, event_data};
use blitz_traits::events::{
    BlitzImeEvent, BlitzInputEvent, BlitzKeyEvent, BlitzPointerEvent, BlitzScrollEvent,
    BlitzWheelDelta, BlitzWheelEvent, DomEvent, DomEventData,
};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyPayload {
    pub key: String,
    pub code: String,
    pub mods: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputPayload {
    pub value: String,
    pub data: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrollPayload {
    pub scroll_top: f64,
    pub scroll_left: f64,
    pub scroll_width: i32,
    pub scroll_height: i32,
    pub client_width: i32,
    pub client_height: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImePayload {
    pub data: String,
}

/// Translation of a single emitted [`DomEvent`] into the JS-facing wire
/// format: `(event_code, optional numeric data, json payload)`.
///
/// This is the single event path: blitz-dom's `EventDriver` does hit-testing,
/// bubbling, and click/enter/leave synthesis, emitting one `DomEvent` per
/// dispatched event. The Applier forwards each emitted event through this
/// translation — there is no longer a separate path that re-translates the
/// raw `UiEvent` or re-hit-tests.
///
/// Returns `None` for events the JS side doesn't model (mouse*/touch* legacy
/// variants, `AppleStandardKeybinding`). Those are still processed natively
/// by blitz-dom (hover, focus, etc.) but not forwarded to JS.
pub type TranslatedEvent = (u8, Option<[f64; event_data::LEN]>, String);

pub fn translate_dom_event(dom_event: &DomEvent) -> Option<TranslatedEvent> {
    let mut num_data = None;
    let payload = String::new();
    let code = match &dom_event.data {
        DomEventData::PointerMove(e) => {
            num_data = Some(pointer_numeric(e));
            event::POINTERMOVE
        }
        DomEventData::PointerDown(e) => {
            num_data = Some(pointer_numeric(e));
            event::POINTERDOWN
        }
        DomEventData::PointerUp(e) => {
            num_data = Some(pointer_numeric(e));
            event::POINTERUP
        }
        DomEventData::PointerCancel(e) => {
            num_data = Some(pointer_numeric(e));
            event::POINTERCANCEL
        }
        DomEventData::PointerEnter(e) => {
            num_data = Some(pointer_numeric(e));
            event::POINTERENTER
        }
        DomEventData::PointerLeave(e) => {
            num_data = Some(pointer_numeric(e));
            event::POINTERLEAVE
        }
        DomEventData::PointerOver(e) => {
            num_data = Some(pointer_numeric(e));
            event::POINTEROVER
        }
        DomEventData::PointerOut(e) => {
            num_data = Some(pointer_numeric(e));
            event::POINTEROUT
        }
        DomEventData::Click(_) => event::CLICK,
        DomEventData::ContextMenu(_) => event::CONTEXTMENU,
        DomEventData::DoubleClick(_) => event::DBLCLICK,
        DomEventData::Wheel(e) => {
            num_data = Some(wheel_numeric(e));
            event::WHEEL
        }
        DomEventData::Scroll(e) => {
            return Some((event::SCROLL, None, scroll_payload(e)));
        }
        DomEventData::KeyDown(e) => return Some((event::KEYDOWN, None, key_payload(e))),
        DomEventData::KeyUp(e) => return Some((event::KEYUP, None, key_payload(e))),
        DomEventData::Input(e) => return Some((event::INPUT, None, input_payload(e))),
        DomEventData::Ime(e) => {
            if let BlitzImeEvent::Commit(text) = e {
                return Some((event::IMECOMMIT, None, ime_payload(text)));
            }
            return None;
        }
        DomEventData::Focus(_) => event::FOCUS,
        DomEventData::Blur(_) => event::BLUR,
        DomEventData::FocusIn(_) => event::FOCUSIN,
        DomEventData::FocusOut(_) => event::FOCUSOUT,
        // Legacy mouse* / touch* and keypress are not modeled on the JS side;
        // pointer events cover them. AppleStandardKeybinding is macOS-only and
        // not wired to JS.
        DomEventData::MouseMove(_)
        | DomEventData::MouseDown(_)
        | DomEventData::MouseUp(_)
        | DomEventData::MouseEnter(_)
        | DomEventData::MouseLeave(_)
        | DomEventData::MouseOver(_)
        | DomEventData::MouseOut(_)
        | DomEventData::TouchStart(_)
        | DomEventData::TouchMove(_)
        | DomEventData::TouchEnd(_)
        | DomEventData::TouchCancel(_)
        | DomEventData::KeyPress(_)
        | DomEventData::AppleStandardKeybinding(_) => return None,
    };
    Some((code, num_data, payload))
}

/// Pack a pointer event into the shared numeric event-data slots so JS can
/// read clientX/Y, button, buttons, mods without a JSON parse.
fn pointer_numeric(e: &BlitzPointerEvent) -> [f64; event_data::LEN] {
    let mut data = [0.0; event_data::LEN];
    data[event_data::CLIENT_X as usize] = e.coords.client_x as f64;
    data[event_data::CLIENT_Y as usize] = e.coords.client_y as f64;
    data[event_data::BUTTON as usize] = e.button as u8 as f64;
    data[event_data::BUTTONS as usize] = e.buttons.bits() as f64;
    data[event_data::MODS as usize] = e.mods.bits() as f64;
    data
}

fn wheel_numeric(e: &BlitzWheelEvent) -> [f64; event_data::LEN] {
    let mut data = [0.0; event_data::LEN];
    data[event_data::CLIENT_X as usize] = e.coords.client_x as f64;
    data[event_data::CLIENT_Y as usize] = e.coords.client_y as f64;
    let (dx, dy) = match &e.delta {
        BlitzWheelDelta::Lines(x, y) => (*x, *y),
        BlitzWheelDelta::Pixels(x, y) => (*x, *y),
    };
    data[event_data::DELTA_X as usize] = dx;
    data[event_data::DELTA_Y as usize] = dy;
    data
}

fn key_payload(e: &BlitzKeyEvent) -> String {
    serde_json::to_string(&KeyPayload {
        key: e.key.to_string(),
        code: e.code.to_string(),
        mods: e.modifiers.bits(),
    })
    .unwrap()
}

fn input_payload(e: &BlitzInputEvent) -> String {
    serde_json::to_string(&InputPayload {
        value: e.value.clone(),
        data: e.value.clone(),
    })
    .unwrap()
}

fn scroll_payload(e: &BlitzScrollEvent) -> String {
    serde_json::to_string(&ScrollPayload {
        scroll_top: e.scroll_top,
        scroll_left: e.scroll_left,
        scroll_width: e.scroll_width,
        scroll_height: e.scroll_height,
        client_width: e.client_width,
        client_height: e.client_height,
    })
    .unwrap()
}

fn ime_payload(text: &str) -> String {
    serde_json::to_string(&ImePayload {
        data: text.to_string(),
    })
    .unwrap()
}
