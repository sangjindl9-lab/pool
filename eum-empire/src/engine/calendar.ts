import { BALANCE } from './data/balance';

const DPM = BALANCE.calendar.daysPerMonth;
const MPY = BALANCE.calendar.monthsPerYear;

/** 게임 날짜: 1년 = 12개월, 1개월 = 30일 고정 달력 */
export function monthIndex(day: number): number {
  return Math.floor(day / DPM);
}
export function dayOfMonth(day: number): number {
  return (day % DPM) + 1;
}
export function isMonthEnd(day: number): boolean {
  return day % DPM === DPM - 1;
}
export function formatDate(day: number): string {
  const m = monthIndex(day);
  const y = BALANCE.calendar.startYear + Math.floor(m / MPY);
  return `${y}년 ${(m % MPY) + 1}월 ${dayOfMonth(day)}일`;
}
export function formatMonth(index: number): string {
  const y = BALANCE.calendar.startYear + Math.floor(index / MPY);
  return `${y}.${String((index % MPY) + 1).padStart(2, '0')}`;
}
