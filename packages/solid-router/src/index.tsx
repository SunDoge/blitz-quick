import {
  createContext,
  createSignal,
  type JSX,
  Show,
  useContext,
} from "solid-js";

export const RouterContext = createContext<{
  path: () => string;
  navigate: (p: string) => void;
}>();

export function NativeRouter(props: { children: JSX.Element }) {
  const [path, setPath] = createSignal("/");
  return (
    <RouterContext.Provider value={{ path, navigate: setPath }}>
      {props.children}
    </RouterContext.Provider>
  );
}

export function NativeRoute(props: {
  path: string;
  component: () => JSX.Element;
}) {
  const router = useContext(RouterContext);
  return <Show when={router?.path() === props.path}>{props.component()}</Show>;
}

export function useNavigate() {
  const router = useContext(RouterContext);
  if (!router) {
    throw new Error("useNavigate must be used within a NativeRouter");
  }
  return router.navigate;
}

export function useLocation() {
  const router = useContext(RouterContext);
  if (!router) {
    throw new Error("useLocation must be used within a NativeRouter");
  }
  return {
    get pathname() {
      return router.path();
    },
  };
}
