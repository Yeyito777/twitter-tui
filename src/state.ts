import { createEditorState, displayCursor, enterInsertMode, leaveInsertMode, type EditorState } from "./editor";
import type { Account, FeedResult, TimelineItem } from "./types";
import type { NoticeTone } from "./theme";

export type PanelFocus = "sidebar" | "content";
export type ContentFocus = "timeline" | "prompt";
export type AccountStatus = "loading" | "authenticated" | "error";

export interface Notice {
  text: string;
  tone: NoticeTone;
  loading: boolean;
}

export interface ViewSpec {
  id: string;
  label: string;
  icon: string;
  help: string;
}

export const VIEWS: ViewSpec[] = [
  { id: "home", label: "Home", icon: "⌂", help: "algorithmic feed" },
  { id: "latest", label: "Latest", icon: "↯", help: "chronological feed" },
  { id: "notifications", label: "Notifs", icon: "◌", help: "mentions & activity" },
  { id: "bookmarks", label: "Bookmarks", icon: "◆", help: "saved tweets" },
  { id: "trending", label: "Trends", icon: "▲", help: "what's hot" },
  { id: "dms", label: "DMs", icon: "✉", help: "direct messages" },
];

export interface AppState {
  cols: number;
  rows: number;
  panelFocus: PanelFocus;
  contentFocus: ContentFocus;
  sidebarOpen: boolean;
  sidebarIndex: number;
  activeView: string;
  title: string;
  feedKind: string;
  items: TimelineItem[];
  profile: FeedResult["profile"] | null;
  accountStatus: AccountStatus;
  account: Account | null;
  cursors: { top?: string; bottom?: string };
  timelineLoading: boolean;
  timelineLoadingOlder: boolean;
  timelineLoadingNewer: boolean;
  timelineHasOlder: boolean;
  timelineHasNewer: boolean;
  timelineRequestId: number;
  selectedIndex: number;
  scroll: number;
  timelineCursorRow: number;
  timelineCursorCol: number;
  /** Preferred timeline column for repeated j/k movement (Vim curswant). */
  timelineCurswant: number | null;
  timelineLineItemIndexes: number[];
  timelineLinePlain: string[];
  editor: EditorState;
  notice: Notice;
  loadingFrameIndex: number;
  commandHistory: string[];
  commandHistoryIndex: number | null;
  lastArgs: string[];
  currentDmConversationId: string | null;
  replyTargetId: string | null;
  quoteTargetId: string | null;
}

export function createInitialState(): AppState {
  return {
    cols: process.stdout.columns || 100,
    rows: process.stdout.rows || 32,
    panelFocus: "content",
    contentFocus: "prompt",
    sidebarOpen: true,
    sidebarIndex: 0,
    activeView: "home",
    title: "Home",
    feedKind: "home",
    items: [],
    profile: null,
    accountStatus: "loading",
    account: null,
    cursors: {},
    timelineLoading: false,
    timelineLoadingOlder: false,
    timelineLoadingNewer: false,
    timelineHasOlder: false,
    timelineHasNewer: false,
    timelineRequestId: 0,
    selectedIndex: 0,
    scroll: 0,
    timelineCursorRow: 0,
    timelineCursorCol: 1,
    timelineCurswant: null,
    timelineLineItemIndexes: [],
    timelineLinePlain: [],
    editor: createEditorState("", "insert"),
    notice: { text: "", tone: "muted", loading: false },
    loadingFrameIndex: 0,
    commandHistory: [],
    commandHistoryIndex: null,
    lastArgs: ["timeline", "-n", "35"],
    currentDmConversationId: null,
    replyTargetId: null,
    quoteTargetId: null,
  };
}

export function setNotice(state: AppState, text: string, tone: NoticeTone = "muted", loading = false): void {
  state.notice = { text, tone, loading };
}

export function focusNext(state: AppState): void {
  state.panelFocus = state.panelFocus === "sidebar" ? "content" : "sidebar";
  if (state.panelFocus === "content" && state.contentFocus === "prompt") enterInsertMode(state.editor, displayCursor(state.editor));
  else leaveInsertMode(state.editor);
}

export function focusPrev(state: AppState): void {
  state.panelFocus = state.panelFocus === "sidebar" ? "content" : "sidebar";
  if (state.panelFocus === "content" && state.contentFocus === "prompt") enterInsertMode(state.editor, displayCursor(state.editor));
  else leaveInsertMode(state.editor);
}

export function toggleContentFocus(state: AppState): void {
  state.panelFocus = "content";
  state.contentFocus = state.contentFocus === "timeline" ? "prompt" : "timeline";
  if (state.contentFocus === "prompt") enterInsertMode(state.editor, displayCursor(state.editor));
  else leaveInsertMode(state.editor);
}

export function focusPrompt(state: AppState): void {
  state.panelFocus = "content";
  state.contentFocus = "prompt";
  enterInsertMode(state.editor, displayCursor(state.editor));
}

export function focusTimeline(state: AppState): void {
  state.panelFocus = "content";
  state.contentFocus = "timeline";
  leaveInsertMode(state.editor);
}

export function focusSidebar(state: AppState): void {
  state.panelFocus = "sidebar";
  leaveInsertMode(state.editor);
}

export function focusLabel(state: AppState): string {
  if (state.panelFocus === "sidebar") return "nav";
  return state.contentFocus;
}

export function selectedItem(state: AppState): TimelineItem | null {
  return state.items[state.selectedIndex] ?? null;
}

export function clampSelection(state: AppState): void {
  if (state.items.length === 0) {
    state.selectedIndex = 0;
    state.scroll = 0;
    return;
  }
  state.selectedIndex = Math.max(0, Math.min(state.selectedIndex, state.items.length - 1));
}
