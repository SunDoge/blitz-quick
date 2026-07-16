import "@blitz-quick/core";
import "./global.css";
import "virtual:uno.css";
import { mount } from "@blitz-quick/solid-renderer";
import { MemoryRouter, Route } from "@solidjs/router";
import { AppShell } from "./AppShell";
import { ThemeProvider } from "./contexts/ThemeContext";
import { StoryDetail } from "./pages/StoryDetail";
import { StoryList } from "./pages/StoryList";

mount(() => (
  <ThemeProvider>
    <MemoryRouter root={AppShell}>
      <Route path="/" component={StoryList} />
      <Route path="/story/:id" component={StoryDetail} />
    </MemoryRouter>
  </ThemeProvider>
));
