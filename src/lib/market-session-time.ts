import type { MarketSession, MarketSessionStatus } from "@/lib/constants/market-sessions";

export type TimeParts = {
  hour: number;
  minute: number;
  second: number;
  /** Lowercased short weekday in `en-US` for the given zone (e.g. sat, sun). */
  weekdayShort: string;
};

const dtfParts = (timeZone: string, date: Date) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

function partMap(parts: Intl.DateTimeFormatPart[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") m[p.type] = p.value;
  }
  return m;
}

/** Current clock parts in `timeZone` (24-hour; used for hands + session math). */
export function getTimePartsForZone(timeZone: string, date: Date = new Date()): TimeParts {
  const m = partMap(dtfParts(timeZone, date));
  const wd = (m.weekday ?? "").toLowerCase().replace(/\.$/, "");
  return {
    hour: parseInt(m.hour ?? "0", 10),
    minute: parseInt(m.minute ?? "0", 10),
    second: parseInt(m.second ?? "0", 10),
    weekdayShort: wd,
  };
}

export function getMinutesFromTimeString(hhmm: string): number {
  const [h, min] = hhmm.split(":").map((x) => parseInt(x, 10));
  if (Number.isNaN(h) || Number.isNaN(min)) return 0;
  return h * 60 + min;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 24-hour wall-clock string "HH:mm" from constants → "hh:mm ص|م" (display only). */
export function formatTimeString12h(hhmm: string): string {
  const [h24, min] = hhmm.split(":").map((x) => parseInt(x, 10));
  if (Number.isNaN(h24) || Number.isNaN(min)) return hhmm;
  let h12: number;
  let period: "ص" | "م";
  if (h24 === 0) {
    h12 = 12;
    period = "ص";
  } else if (h24 < 12) {
    h12 = h24;
    period = "ص";
  } else if (h24 === 12) {
    h12 = 12;
    period = "م";
  } else {
    h12 = h24 - 12;
    period = "م";
  }
  return `${pad2(h12)}:${pad2(min)} ${period}`;
}

/** 24-hour numeric parts → "hh:mm:ss ص|م" (Latin digits). */
export function formatTime12hFromParts(parts: TimeParts, includeSeconds = true): string {
  const h24 = parts.hour;
  const m = parts.minute;
  const s = parts.second;
  let h12: number;
  let period: "ص" | "م";
  if (h24 === 0) {
    h12 = 12;
    period = "ص";
  } else if (h24 < 12) {
    h12 = h24;
    period = "ص";
  } else if (h24 === 12) {
    h12 = 12;
    period = "م";
  } else {
    h12 = h24 - 12;
    period = "م";
  }
  if (includeSeconds) {
    return `${pad2(h12)}:${pad2(m)}:${pad2(s)} ${period}`;
  }
  return `${pad2(h12)}:${pad2(m)} ${period}`;
}

/** Live clock label in zone (12-hour Arabic ص/م). */
export function formatZoneTimeLabel12h(timeZone: string, date: Date): string {
  return formatTime12hFromParts(getTimePartsForZone(timeZone, date), true);
}

function formatDateInZone(timeZone: string, date: Date): string {
  return new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function isWeekendInZone(timeZone: string, date: Date): boolean {
  const w = getTimePartsForZone(timeZone, date).weekdayShort;
  return w === "sat" || w === "sun";
}

export function getSessionStatus(session: MarketSession, date: Date = new Date()): MarketSessionStatus {
  const localTimeLabel = formatZoneTimeLabel12h(session.timezone, date);
  const localDateLabel = formatDateInZone(session.timezone, date);

  if (session.type === "reference") {
    return {
      isOpen: false,
      labelAr: "مرجع زمني",
      tone: "neutral",
      localTimeLabel,
      localDateLabel,
    };
  }

  const openTime = session.openTime ?? "08:00";
  const closeTime = session.closeTime ?? "17:00";
  const openM = getMinutesFromTimeString(openTime);
  const closeM = getMinutesFromTimeString(closeTime);
  const parts = getTimePartsForZone(session.timezone, date);
  const currentM = parts.hour * 60 + parts.minute;

  if (isWeekendInZone(session.timezone, date)) {
    return {
      isOpen: false,
      labelAr: "مغلق",
      tone: "danger",
      localTimeLabel,
      localDateLabel,
    };
  }

  const sessionLen = closeM - openM;
  const inSession = currentM >= openM && currentM < closeM;
  const nearClose = inSession && currentM >= closeM - 60;
  const nearOpen = !inSession && currentM >= openM - 60 && currentM < openM;

  if (inSession && nearClose) {
    return {
      isOpen: true,
      labelAr: "يغلق قريبًا",
      tone: "warning",
      localTimeLabel,
      localDateLabel,
      minutesToClose: closeM - currentM,
      progress: sessionLen > 0 ? (currentM - openM) / sessionLen : 0,
    };
  }

  if (inSession) {
    return {
      isOpen: true,
      labelAr: "مفتوح",
      tone: "ok",
      localTimeLabel,
      localDateLabel,
      minutesToClose: closeM - currentM,
      progress: sessionLen > 0 ? (currentM - openM) / sessionLen : 0,
    };
  }

  if (nearOpen) {
    return {
      isOpen: false,
      labelAr: "يفتح قريبًا",
      tone: "warning",
      localTimeLabel,
      localDateLabel,
      minutesToOpen: openM - currentM,
    };
  }

  if (currentM < openM) {
    return {
      isOpen: false,
      labelAr: "مغلق",
      tone: "danger",
      localTimeLabel,
      localDateLabel,
      minutesToOpen: openM - currentM,
    };
  }

  return {
    isOpen: false,
    labelAr: "مغلق",
    tone: "danger",
    localTimeLabel,
    localDateLabel,
  };
}
