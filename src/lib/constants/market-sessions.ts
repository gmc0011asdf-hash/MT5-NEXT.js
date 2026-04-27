export type MarketSessionId = "sydney" | "tokyo" | "london" | "newyork" | "baghdad";

export type MarketSessionType = "market" | "reference";

export type MarketSessionStatusTone = "ok" | "warning" | "danger" | "neutral";

export type MarketSessionStatus = {
  isOpen: boolean;
  labelAr: "مفتوح" | "مغلق" | "يفتح قريبًا" | "يغلق قريبًا" | "مرجع زمني";
  tone: MarketSessionStatusTone;
  localTimeLabel: string;
  localDateLabel: string;
  minutesToOpen?: number;
  minutesToClose?: number;
  progress?: number;
};

export type MarketSession = {
  id: MarketSessionId;
  nameAr: string;
  nameEn: string;
  timezone: string;
  openTime?: `${number}:${number}` | string;
  closeTime?: `${number}:${number}` | string;
  type: MarketSessionType;
};

export const MARKET_SESSIONS: MarketSession[] = [
  {
    id: "sydney",
    nameAr: "سيدني",
    nameEn: "Sydney",
    timezone: "Australia/Sydney",
    openTime: "08:00",
    closeTime: "17:00",
    type: "market",
  },
  {
    id: "tokyo",
    nameAr: "طوكيو",
    nameEn: "Tokyo",
    timezone: "Asia/Tokyo",
    openTime: "09:00",
    closeTime: "18:00",
    type: "market",
  },
  {
    id: "london",
    nameAr: "لندن",
    nameEn: "London",
    timezone: "Europe/London",
    openTime: "08:00",
    closeTime: "17:00",
    type: "market",
  },
  {
    id: "newyork",
    nameAr: "نيويورك",
    nameEn: "New York",
    timezone: "America/New_York",
    openTime: "08:00",
    closeTime: "17:00",
    type: "market",
  },
  {
    id: "baghdad",
    nameAr: "توقيت العراق المحلي",
    nameEn: "Iraq local",
    timezone: "Asia/Baghdad",
    type: "reference",
  },
];
