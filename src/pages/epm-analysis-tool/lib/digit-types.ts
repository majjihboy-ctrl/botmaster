export type ContractMode =
  | 'DIGITMATCH'
  | 'DIGITDIFF'
  | 'DIGITOVER'
  | 'DIGITUNDER'
  | 'DIGITEVEN'
  | 'DIGITODD';

export type TradeType = 'matches-differs' | 'over-under' | 'even-odd';

export interface DigitStats {
  /** Count of each digit 0-9 from tick history */
  counts: number[];
  /** Percentage of each digit 0-9 */
  percentages: number[];
  /** Total number of ticks analyzed */
  totalTicks: number;
}
