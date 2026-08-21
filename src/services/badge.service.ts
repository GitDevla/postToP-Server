import {type ExtendedWebSocketConnection, VideoStatus} from "../interface/websocket";
import {logger} from "../utils/logger";

type CurrentlyPlaying = NonNullable<ExtendedWebSocketConnection["currentlyPlayingData"]>;

const WIDTH = 420;
const HEIGHT = 128;
const COVER_SIZE = 104;
const CONTENT_X = 128;
const CONTENT_WIDTH = WIDTH - CONTENT_X - 12;
const ROW_HEIGHT = 14;
const DIGIT_WIDTH = 6;
const COVER_CACHE_MS = 5 * 60 * 1000;

const coverCache = new Map<string, {dataUri: string; expiresAt: number}>();

const STYLES = `
  text { font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; }
  .label { font-size: 10px; font-weight: 500; letter-spacing: 0.08em; fill: #9AA4B2; }
  .title { font-size: 15px; font-weight: 500; fill: #E6E9EE; }
  .artist { font-size: 12px; fill: #9AA4B2; }
  .time { font-size: 10px; fill: #9AA4B2; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .empty { font-size: 13px; fill: #9AA4B2; }
`;

export class BadgeService {
  static async renderNowPlaying(playing: CurrentlyPlaying | undefined) {
    return playing ? await renderTrack(playing) : renderEmpty();
  }
}

async function renderTrack({video, listeningData}: CurrentlyPlaying) {
  const isPaused = listeningData.status === VideoStatus.PAUSED;
  const elapsed = elapsedSeconds(listeningData, video.duration);
  const remaining = Math.max(0, video.duration - elapsed);
  const progress = video.duration > 0 ? elapsed / video.duration : 0;
  const accent = isPaused ? "#9AA4B2" : "#8B5CF6";
  const {title, artist} = formatTrackText(video);
  const cover = await fetchCoverDataUri(video.watchID);
  // the badge is a static file once served, so the rest of the track is extrapolated into SMIL animations
  const animated = isRunning(listeningData) && remaining > 0;

  return card(`
    <clipPath id="cover"><rect x="12" y="12" width="${COVER_SIZE}" height="${COVER_SIZE}" rx="8"/></clipPath>
    <rect x="12" y="12" width="${COVER_SIZE}" height="${COVER_SIZE}" rx="8" fill="#1B212A"/>
    ${cover ? `<image xlink:href="${cover}" x="12" y="12" width="${COVER_SIZE}" height="${COVER_SIZE}" preserveAspectRatio="xMidYMid slice" clip-path="url(#cover)"/>` : ""}

    <circle cx="${CONTENT_X + 3}" cy="27" r="3" fill="${accent}"/>
    <text class="label" x="${CONTENT_X + 14}" y="31">${isPaused ? "PAUSED" : "NOW PLAYING"}</text>

    <text class="title" x="${CONTENT_X}" y="60">${escapeXml(truncate(title, 34))}</text>
    <text class="artist" x="${CONTENT_X}" y="79">${escapeXml(truncate(artist, 42))}</text>

    <rect x="${CONTENT_X}" y="97" width="${CONTENT_WIDTH}" height="3" rx="1.5" fill="#232A35"/>
    <rect x="${CONTENT_X}" y="97" width="${(CONTENT_WIDTH * progress).toFixed(1)}" height="3" rx="1.5" fill="${accent}">${
      animated
        ? `<animate attributeName="width" from="${(CONTENT_WIDTH * progress).toFixed(1)}" to="${CONTENT_WIDTH}" dur="${remaining.toFixed(1)}s" fill="freeze"/>`
        : ""
    }</rect>

    ${animated ? elapsedTicker(CONTENT_X, 116, elapsed, video.duration) : staticTime(CONTENT_X, 116, "start", formatTime(elapsed))}
    ${staticTime(WIDTH - 12, 116, "end", formatTime(video.duration))}
  `);
}

function renderEmpty() {
  return card(`
    <circle cx="${WIDTH / 2 - 78}" cy="${HEIGHT / 2 - 4}" r="3" fill="#5F6B7A"/>
    <text class="empty" x="${WIDTH / 2 + 6}" y="${HEIGHT / 2}" text-anchor="middle">Not listening to anything</text>
  `);
}

function card(body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img">
  <style>${STYLES}</style>
  <rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${HEIGHT - 1}" rx="12" fill="#151A21" stroke="#232A35"/>
  ${body}
</svg>`;
}

// GitHub's camo proxy will not resolve external references inside an SVG, so the cover has to be inlined
async function fetchCoverDataUri(watchID: string) {
  const cached = coverCache.get(watchID);
  if (cached && cached.expiresAt > Date.now()) return cached.dataUri;

  try {
    const response = await fetch(`https://i.ytimg.com/vi/${watchID}/mqdefault.jpg`);
    if (!response.ok) return null;
    const image = Buffer.from(await response.arrayBuffer());
    const dataUri = `data:image/jpeg;base64,${image.toString("base64")}`;
    cacheCover(watchID, dataUri);
    return dataUri;
  } catch (error) {
    logger.warn(`Failed to fetch cover for ${watchID}: ${error}`);
    return null;
  }
}

// Only successful fetches are cached, so a transient YouTube failure does not blank the cover for five minutes
function cacheCover(watchID: string, dataUri: string) {
  const now = Date.now();
  for (const [key, entry] of coverCache) {
    if (entry.expiresAt <= now) coverCache.delete(key);
  }
  coverCache.set(watchID, {dataUri, expiresAt: now + COVER_CACHE_MS});
}

function formatTrackText(video: CurrentlyPlaying["video"]) {
  const ner = video.NER as Record<string, string[]> | undefined;
  const modifiers = ner?.MODIFIER?.length ? ` (${ner.MODIFIER.join(", ")})` : "";
  return {
    title: ner?.TITLE?.[0] ? `${ner.TITLE[0]}${modifiers}` : video.title,
    artist: video.artist.name.replace("- Topic", "").trim(),
  };
}

function isRunning(listeningData: CurrentlyPlaying["listeningData"]) {
  return listeningData.status === VideoStatus.PLAYING || listeningData.status === VideoStatus.STARTED;
}

function elapsedSeconds(listeningData: CurrentlyPlaying["listeningData"], duration: number) {
  const sinceUpdate = isRunning(listeningData) ? (Date.now() - new Date(listeningData.updatedAt).getTime()) / 1000 : 0;
  return Math.min(duration, Math.max(0, listeningData.currentTime + sinceUpdate));
}

function staticTime(x: number, y: number, anchor: "start" | "end", value: string) {
  return `<text class="time mono" x="${x}" y="${y}" text-anchor="${anchor}" ${glyphWidth(value)}>${value}</text>`;
}

// Pins every glyph to the same advance, so the columns line up whichever monospace font the viewer resolves
function glyphWidth(value: string) {
  return `textLength="${value.length * DIGIT_WIDTH}" lengthAdjust="spacingAndGlyphs"`;
}

// A digit column is a vertical strip of glyphs clipped to one row and stepped through with a discrete
// translate, so the clock ticks without a single value ever being recomputed client-side.
function digitColumn(id: string, x: number, y: number, options: DigitColumnOptions) {
  const {values, anchor, width, durSeconds, offsetSeconds, endSeconds, repeat} = options;
  const clipX = anchor === "end" ? x - width : x;
  const glyphs = values
    .map(
      (value, index) =>
        `<text class="time mono" x="${x}" y="${y + index * ROW_HEIGHT}" text-anchor="${anchor}" ${glyphWidth(value)}>${value}</text>`,
    )
    .join("");
  const steps = values.map((_, index) => `0,${-index * ROW_HEIGHT}`).join(";");

  return `<clipPath id="tick-${id}"><rect x="${clipX}" y="${y - ROW_HEIGHT + 4}" width="${width}" height="${ROW_HEIGHT}"/></clipPath>
    <g clip-path="url(#tick-${id})"><g>${glyphs}<animateTransform attributeName="transform" type="translate" calcMode="discrete" values="${steps}" dur="${durSeconds}s" begin="-${offsetSeconds}s" end="${endSeconds}s"${repeat ? ' repeatCount="indefinite"' : ""} fill="freeze"/></g></g>`;
}

type DigitColumnOptions = {
  values: string[];
  anchor: "start" | "end";
  width: number;
  durSeconds: number;
  offsetSeconds: number;
  endSeconds: number;
  repeat: boolean;
};

function elapsedTicker(x: number, y: number, elapsed: number, duration: number) {
  const start = Math.floor(elapsed);
  const endSeconds = Math.ceil(duration - elapsed);
  const lastMinute = Math.floor(duration / 60);
  const colonX = x + String(lastMinute).length * DIGIT_WIDTH;
  const minutes = [];
  for (let minute = Math.floor(start / 60); minute <= lastMinute; minute++) minutes.push(String(minute));

  return `${digitColumn("m", colonX, y, {
    values: minutes,
    anchor: "end",
    width: colonX - x,
    durSeconds: minutes.length * 60,
    offsetSeconds: start % 60,
    endSeconds,
    repeat: false,
  })}
    <text class="time mono" x="${colonX}" y="${y}" ${glyphWidth(":")}>:</text>
    ${digitColumn("t", colonX + DIGIT_WIDTH, y, {
      values: ["0", "1", "2", "3", "4", "5"],
      anchor: "start",
      width: DIGIT_WIDTH,
      durSeconds: 60,
      offsetSeconds: start % 60,
      endSeconds,
      repeat: true,
    })}
    ${digitColumn("o", colonX + DIGIT_WIDTH * 2, y, {
      values: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
      anchor: "start",
      width: DIGIT_WIDTH,
      durSeconds: 10,
      offsetSeconds: start % 10,
      endSeconds,
      repeat: true,
    })}`;
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}

function truncate(text: string, maxLength: number) {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

function escapeXml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
