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

/** Current clock parts in `timeZone` (no hardcoded offsets; DST via Intl). */
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

function formatTimeInZone(timeZone: string, date: Date): string {
  return new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
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
  const localTimeLabel = formatTimeInZone(session.timezone, date);
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
