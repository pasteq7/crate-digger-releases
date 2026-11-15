export type Mode = "safe" | "adjacent" | "wildcard";
export type Shelf = "wishlist" | "rejected";
export type View =
  "discover" | "taste" | Shelf | "settings" | "imports" | "activity";
export type Kind = "album" | "track" | "artist";
export type Engine = "catalog" | "ai";
export interface Track {
  path: string;
  root: string;
  folder: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  year: number | null;
}
export interface Count {
  name: string;
  count: number;
}
export interface Profile {
  total: number;
  albums: number;
  genres: Count[];
  artists: Count[];
  eras: Count[];
}
export interface Item {
  loadingPreview?: boolean;
  id: string;
  kind: Kind;
  title: string;
  album?: string;
  artist: string;
  genre: string;
  year: number | null;
  cover: string;
  preview: string | null;
  previewTitle?: string;
  previewTrack?: string;
  releaseType?: "album" | "ep" | "track" | "playlist";
  soundcloud?: SoundCloudSource;
  previewSource?: "apple" | "deezer";
  reason: string;
  seeds: string[];
  sourceFolder: string;
  catalogUrl?: string;
  storeUrl?: string;
  trackUrl?: string;
  trackCount?: number | null;
  trackCountSource?: string;
  trackCountEdition?: string;
  catalogVerified?: boolean;
  origin?: "ai";
  discoveryScope?: string;
  discoveryMode?: Mode;
  basedOn?: { artist: string; album: string }[];
}
export interface ShelfEntry {
  item: Item;
  status: Shelf;
  added: string;
}
export interface Settings {
  mode: Mode;
  theme: "dark" | "light";
  ai: "none" | "ollama" | "openai" | "gemini";
  aiModel: string;
  aiEndpoint: string;
  autoScan: boolean;
  view: View;
  scope: string;
  kind: Kind;
  engine?: Engine;
  externalCommand?: string;
  externalCwdMode?: "scan" | "custom";
  externalCwd?: string;
  externalAutoOpenImport?: boolean;
  hasAiKey?: boolean;
  importRoot?: string;
  hasAiKeys?: { openai: boolean; gemini: boolean };
  hasYoutubeKey?: boolean;
  hasSoundcloudCredentials?: boolean;
}
export interface SoundCloudSource {
  url: string;
  title: string;
  artist: string;
  uploader: string;
  uploaderUrl?: string;
  kind: "track" | "album";
  releaseType: "track" | "album" | "ep" | "playlist";
  access: "playable" | "preview" | "unknown";
  confirmed: boolean;
  closeMatch?: boolean;
  cover?: string;
  genre?: string;
  year?: number | null;
  trackCount?: number | null;
}
export interface YoutubeVideo {
  id: string;
  title: string;
  channel: string;
  duration: string;
  closeMatch: boolean;
}
export type SettingsUpdate = Partial<Settings> & {
  aiKey?: string;
  youtubeKey?: string;
  soundcloudCredentials?: { clientId: string; clientSecret: string } | null;
};
export interface Progress {
  wishlistRemoved?: number;
  running: boolean;
  checked: number;
  updated: number;
  errors: number;
  current: string;
}
export interface State {
  tracks: Track[];
  profile: Profile;
  folders: string[];
  shelves: Record<string, ShelfEntry>;
  settings: Settings;
  history: (Profile & { day: string })[];
  lastScan: string | null;
  progress: Progress | null;
  imports?: ImportJob[];
  externalJobs?: ExternalJob[];
  aiActivity?: AiActivityState;
}
export interface AiCall {
  id: string;
  provider: string;
  model: string;
  purpose: string;
  generation: boolean;
  started: string;
  finished?: string;
  durationMs?: number;
  status: "running" | "retrying" | "succeeded" | "failed" | "cancelled";
  attempts: number;
  retries: { attempt: number; delay: number; message: string }[];
  usage: {
    input: number | null;
    output: number | null;
    total: number | null;
    reasoning: number | null;
    cached: number | null;
  };
  unreported: number;
  result?: string;
  error?: string;
}
export interface AiActivityState {
  calls: AiCall[];
  totals: {
    calls: number;
    succeeded: number;
    failed: number;
    cancelled: number;
    retries: number;
    input: number;
    output: number;
    total: number;
    reasoning: number;
    cached: number;
    unreported: number;
  };
}
export interface ExternalJob {
  id: string;
  title: string;
  artist: string;
  amazonUrl: string;
  url?: string;
  urlSource?: "pasted" | "lookup";
  cwd: string;
  command: string;
  phase: "running" | "importing" | "complete" | "failed" | "cancelled";
  started: string;
  finished?: string;
  output: string;
  exitCode?: number | null;
  error?: string;
  importIds: string[];
  outputPaths: string[];
  autoOpenImport: boolean;
}
export interface ImportOptions {
  destinationFolder: string;
  tagGenre: boolean;
  cleanComments: boolean;
}
export interface ImportRoutes {
  root: string;
  folders: string[];
  truncated: boolean;
}
export interface ImportJob {
  destinationFolder?: string;
  tagGenre?: boolean;
  kind?: "zip" | "folder";
  sourceRemoved?: boolean;
  originalBackup?: string;
  id: string;
  zip: string;
  name: string;
  root: string;
  genre: string;
  phase:
    "queued" | "extracting" | "copying" | "tagging" | "complete" | "failed";
  done: number;
  total: number;
  current?: string;
  destination?: string;
  tracks?: number;
  warnings?: string[];
  error?: string;
  indexWarning?: string;
}
export interface Options {
  scope: string;
  mode: Mode;
  offset: number;
  gaps: boolean;
  kind: Kind;
  requestId?: number;
}
export interface Result {
  items: Item[];
  message?: string;
  warning?: string;
  pending?: boolean;
}
export interface Bridge {
  onAiActivity: (callback: (state: AiActivityState) => void) => () => void;
  releaseCount: (item: Item) => Promise<Partial<Item>>;
  externalRunUrl: (
    url: string,
    scope: string,
    item?: Item,
  ) => Promise<ExternalJob>;
  soundcloudSearch: (item: Item) => Promise<SoundCloudSource[]>;
  soundcloudResolve: (url: string) => Promise<SoundCloudSource>;
  youtubeSearch: (item: Item) => Promise<YoutubeVideo[]>;
  onYoutubeSuspend: (callback: () => void) => () => void;
  updateState: () => Promise<UpdateState>;
  checkUpdates: () => Promise<UpdateState>;
  installUpdate: () => Promise<boolean>;
  automaticUpdates: (value: boolean) => Promise<UpdateState>;
  onUpdate: (callback: (state: UpdateState) => void) => () => void;
  externalFolder: () => Promise<string | null>;
  externalRun: (item: Item, scope: string) => Promise<ExternalJob>;
  externalCancel: (id: string) => Promise<boolean>;
  externalClear: (id?: string) => Promise<ExternalJob[]>;
  externalImport: (id: string, options: ImportOptions) => Promise<ImportJob[]>;
  onExternal: (callback: (jobs: ExternalJob[]) => void) => () => void;
  onExternalClose: (callback: () => void) => () => void;
  onImportClose: (callback: () => void) => () => void;
  filePath: (file: File) => string;
  refreshPreview: (item: Item) => Promise<Partial<Item> | null>;
  importDestination: () => Promise<Settings | null>;
  importRoutes: () => Promise<ImportRoutes>;
  chooseZips: () => Promise<string[]>;
  chooseImportFolder: () => Promise<string[]>;
  importFiles: (
    files: string[],
    options: ImportOptions,
  ) => Promise<ImportJob[]>;
  importZips: (files: string[], options: ImportOptions) => Promise<ImportJob[]>;
  onImports: (cb: (jobs: ImportJob[]) => void) => () => void;
  musicLink: (
    item: Item,
    action: "amazon" | "copy" | "youtube" | "retry",
  ) => Promise<{
    amazon: string;
    youtube: string;
    exact: boolean;
    reason?: string;
    alternatives?: {
      amazon: string;
      title: string;
      trackCount: number | null;
    }[];
  }>;
  state: () => Promise<State>;
  chooseFolder: () => Promise<State | null>;
  removeFolder: (root: string) => Promise<State>;
  scan: () => Promise<unknown>;
  discover: (options: Options) => Promise<Result>;
  aiContext: (scope: string) => Promise<AiContext>;
  aiDiscover: (options: {
    scope: string;
    mode: Mode;
    batch: number;
    requestId: number;
    exclude: { artist: string; album: string; kind?: Kind }[];
    brief?: string;
    soundcloud?: boolean;
  }) => Promise<AiResult>;
  cancelAi: () => Promise<boolean>;
  shelf: (
    item: Item,
    status: Shelf | null,
  ) => Promise<Record<string, ShelfEntry>>;
  settings: (value: SettingsUpdate) => Promise<Settings>;
  export: (items: Item[], format: "txt" | "csv") => Promise<boolean>;
  explain: (item: Item) => Promise<string>;
  testAi: (options: {
    provider: "gemini";
    key?: string;
    model: string;
  }) => Promise<{ models: string[]; selectedModelAvailable: boolean }>;
  external: (url: string) => Promise<unknown>;
  onFinds: (
    cb: (data: {
      requestId: number;
      items: Item[];
      pending: boolean;
      shelfUpdate?: { id: string; item: Item } | null;
      engine?: "ai";
      stats?: AiStats;
      cached?: boolean;
      contextAlbums?: number;
      message?: string;
    }) => void,
  ) => () => void;
  onScan: (cb: (p: Progress) => void) => () => void;
}
export interface UpdateState {
  version: string;
  nextVersion?: string;
  phase:
    | "disabled"
    | "idle"
    | "checking"
    | "current"
    | "available"
    | "downloading"
    | "ready"
    | "installing"
    | "error";
  message: string;
  automatic: boolean;
  percent?: number;
  checkedAt?: string;
}
export interface AiContext {
  label: string;
  totalAlbums: number;
  albums: {
    id: number;
    artist: string;
    album: string;
    genre: string;
    year: number | null;
    folders: string[];
  }[];
  feedback: { artist: string; album: string; choice: Shelf }[];
}
export interface AiStats {
  suggested: number;
  checked: number;
  playable: number;
  noPreview: number;
  unverified: number;
}
export interface AiResult {
  exchange?: {
    provider: string;
    model: string;
    prompt: string;
    response: string;
    filtered: number;
  };
  items: Item[];
  pending: boolean;
  stats: AiStats;
  cached: boolean;
  contextAlbums: number;
  engine: "ai";
  requestId: number;
  message?: string;
}
declare global {
  interface Window {
    crate?: Bridge;
  }
}
