export const LOCATIONS = [
  'upper_left', 'stomach', 'upper_right',
  'side_left', 'navel', 'side_right',
  'lower_left', 'lower_center', 'lower_right',
] as const;
export type Location = (typeof LOCATIONS)[number];

export const LOCATION_LABELS: Record<Location, string> = {
  upper_left: 'Oberbauch links',
  stomach: 'Magen',
  upper_right: 'Oberbauch rechts',
  side_left: 'Seite links',
  navel: 'Nabel',
  side_right: 'Seite rechts',
  lower_left: 'Unterbauch links',
  lower_center: 'Unterbauch Mitte',
  lower_right: 'Unterbauch rechts',
};

export const PAIN_TYPES = [
  'cramping', 'stabbing', 'pressing', 'burning',
  'bloating', 'dull', 'pulling', 'nausea',
] as const;
export type PainType = (typeof PAIN_TYPES)[number];

export const PAIN_TYPE_LABELS: Record<PainType, string> = {
  cramping: 'Krampfartig',
  stabbing: 'Stechend',
  pressing: 'Drückend',
  burning: 'Brennend',
  bloating: 'Blähung/Völle',
  dull: 'Dumpf',
  pulling: 'Ziehend',
  nausea: 'Übelkeit',
};

export type Duration = 'now' | '1-3h' | 'morning' | 'all_day';
export const DURATION_LABELS: Record<Duration, string> = {
  now: 'gerade eben',
  '1-3h': '1–3 h',
  morning: 'seit dem Morgen',
  all_day: 'ganzer Tag',
};

export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export const MEAL_LABELS: Record<Meal, string> = {
  breakfast: 'Frühstück',
  lunch: 'Mittag',
  dinner: 'Abend',
  snack: 'Snack',
};

export type PainEntry = {
  id: number;
  timestamp: number;
  locations: Location[];
  types: PainType[];
  vas: number;
  duration: Duration | null;
  note: string | null;
};

export type IntakeEntry = {
  id: number;
  timestamp: number;
  meal: Meal;
  kind: 'food' | 'drink';
  category: string;
  amount: number;
};

export type Recommendation = {
  id: number;
  date: string;
  ruleId: string;
  text: string;
  done: boolean;
};

export const FOOD_CATEGORIES: { key: string; label: string }[] = [
  { key: 'dairy', label: 'Milchprodukte' },
  { key: 'wheat', label: 'Weizen/Brot' },
  { key: 'legumes', label: 'Hülsenfrüchte' },
  { key: 'fatty', label: 'Fettig/Frittiert' },
  { key: 'spicy', label: 'Scharf' },
  { key: 'sweets', label: 'Süßes' },
  { key: 'raw', label: 'Rohkost' },
  { key: 'onion_garlic', label: 'Zwiebel/Knoblauch' },
  { key: 'meat', label: 'Fleisch' },
  { key: 'convenience', label: 'Fertiggericht' },
  { key: 'large_portion', label: 'Große Portion' },
];

export const DRINK_CATEGORIES: { key: string; label: string }[] = [
  { key: 'water', label: 'Wasser' },
  { key: 'coffee', label: 'Kaffee' },
  { key: 'tea', label: 'Tee' },
  { key: 'carbonated', label: 'Kohlensäure' },
  { key: 'alcohol', label: 'Alkohol' },
  { key: 'softdrink', label: 'Softdrink/Saft' },
];
