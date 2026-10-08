/**
 * Market hours utility for Indian Equities (NSE/BSE)
 * Trading hours: 09:00 AM to 03:30 PM IST (Monday - Friday)
 */

export interface MarketSessionInfo {
  isLive: boolean;
  statusLabel: string;
  effectiveTradingDate: string; // YYYY-MM-DD
  previousTradingDate: string;  // YYYY-MM-DD
  istTimeString: string;
}

// Convert any date to IST Date components
export function getISTDate(date: Date = new Date()): {
  year: number;
  month: number; // 1-12
  day: number;
  dayOfWeek: number; // 0 (Sun) - 6 (Sat)
  hours: number;
  minutes: number;
  dateStr: string; // YYYY-MM-DD
  timeStr: string; // HH:MM AM/PM
} {
  // IST is UTC + 5.5 hours
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  const istTime = new Date(utc + 5.5 * 3600000);

  const year = istTime.getFullYear();
  const month = istTime.getMonth() + 1;
  const day = istTime.getDate();
  const dayOfWeek = istTime.getDay();
  const hours = istTime.getHours();
  const minutes = istTime.getMinutes();

  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  const dateStr = `${year}-${pad(month)}-${pad(day)}`;

  const ampm = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  const timeStr = `${pad(displayHours)}:${pad(minutes)} ${ampm} IST`;

  return { year, month, day, dayOfWeek, hours, minutes, dateStr, timeStr };
}

// Format date to YYYY-MM-DD
function formatDate(d: Date): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Get the previous business day (excluding Sat/Sun)
export function getPreviousTradingDay(refDate: Date): string {
  const d = new Date(refDate);
  do {
    d.setDate(d.getDate() - 1);
  } while (d.getDay() === 0 || d.getDay() === 6); // Skip Sun (0) and Sat (6)
  return formatDate(d);
}

// Determine if market is currently live and the effective target trading date
export function getMarketSessionInfo(): MarketSessionInfo {
  const now = new Date();
  const ist = getISTDate(now);

  const isWeekday = ist.dayOfWeek >= 1 && ist.dayOfWeek <= 5;
  const totalMinutes = ist.hours * 60 + ist.minutes;
  const marketOpenMinutes = 9 * 60; // 09:00 AM
  const marketCloseMinutes = 15 * 60 + 30; // 03:30 PM

  // Market is live between 09:00 AM and 03:30 PM on weekdays
  const isLive = isWeekday && totalMinutes >= marketOpenMinutes && totalMinutes < marketCloseMinutes;

  // Previous completed trading day
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const istDateObj = new Date(utc + 5.5 * 3600000);
  const previousTradingDate = getPreviousTradingDay(istDateObj);

  let effectiveTradingDate = ist.dateStr;
  let statusLabel = "";

  if (isLive) {
    // When market is live, show PREVIOUS DAY'S completed script as instructed
    effectiveTradingDate = previousTradingDate;
    statusLabel = `Market Live (09:00–15:30) • Displaying Previous Close (${previousTradingDate})`;
  } else if (isWeekday && totalMinutes < marketOpenMinutes) {
    // Pre-market on a weekday: show previous trading day
    effectiveTradingDate = previousTradingDate;
    statusLabel = `Pre-Market • Displaying Previous Close (${previousTradingDate})`;
  } else if (!isWeekday) {
    // Weekend: show Friday's close
    effectiveTradingDate = previousTradingDate;
    statusLabel = `Weekend Closed • Displaying Friday Close (${previousTradingDate})`;
  } else {
    // Post-market (after 15:30): Today's trading day is complete!
    effectiveTradingDate = ist.dateStr;
    statusLabel = `Market Closed • Displaying Today's Completed Session (${ist.dateStr})`;
  }

  return {
    isLive,
    statusLabel,
    effectiveTradingDate,
    previousTradingDate,
    istTimeString: ist.timeStr,
  };
}
