/**
 * data.ts - ~250 synthetic exoplanets generated deterministically.
 *
 * The distributions are loosely modeled on the NASA Exoplanet Archive
 * but the values are synthetic so we can ship them inline (no fetch).
 * What matters is that each dimension spans a range wide enough that
 * brushing is interesting and that the dimensions are partly
 * correlated (Kepler-style hot Jupiters cluster, M-dwarf low-temp
 * hosts cluster, etc.).
 */

export interface Planet {
  name: string;
  /** Year first reported. 1995..2024 */
  discovery_year: number;
  /** Discovery technique. */
  discovery_method: 'Transit' | 'Radial Velocity' | 'Microlensing' | 'Imaging' | 'TTV' | 'Astrometry';
  /** Distance from Earth (parsec). 4..3000 */
  distance_pc: number;
  /** Planet mass in Earth masses. 0.1..6000 */
  mass_earth: number;
  /** Planet radius in Earth radii. 0.5..25 */
  radius_earth: number;
  /** Orbital period (days). 0.5..50000 */
  orbital_period_d: number;
  /** Host star effective temperature (K). 2500..10000 */
  host_star_temp_k: number;
  /** Semi-major axis (AU). 0.005..50 */
  semi_major_axis_au: number;
  /** Equilibrium temperature (K). 100..3500 */
  eq_temp_k: number;
}

export const DIMENSIONS = {
  numeric: [
    'discovery_year',
    'distance_pc',
    'mass_earth',
    'radius_earth',
    'orbital_period_d',
    'host_star_temp_k',
    'semi_major_axis_au',
    'eq_temp_k',
  ] as const,
  categorical: ['discovery_method'] as const,
};

export type NumericDim = typeof DIMENSIONS.numeric[number];
export type CategoricalDim = typeof DIMENSIONS.categorical[number];
export type Dim = NumericDim | CategoricalDim;

export const DIM_LABELS: Record<Dim, string> = {
  discovery_year: 'Discovery year',
  distance_pc: 'Distance (pc)',
  mass_earth: 'Mass (Earth)',
  radius_earth: 'Radius (Earth)',
  orbital_period_d: 'Orbital period (days)',
  host_star_temp_k: 'Host star T (K)',
  semi_major_axis_au: 'Semi-major axis (AU)',
  eq_temp_k: 'Eq. temp (K)',
  discovery_method: 'Discovery method',
};

/** Whether a dimension benefits from a log scale. */
export const LOG_SCALE: Record<NumericDim, boolean> = {
  discovery_year: false,
  distance_pc: true,
  mass_earth: true,
  radius_earth: false,
  orbital_period_d: true,
  host_star_temp_k: false,
  semi_major_axis_au: true,
  eq_temp_k: false,
};

// ---------------------------------------------------------------------------
// Seeded PRNG so the dataset is identical across peers / reloads.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randn(rng: () => number): number {
  // Box-Muller
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)] as T;
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

const METHODS: Planet['discovery_method'][] = [
  'Transit', 'Transit', 'Transit', 'Transit', 'Transit',  // ~50% Transit
  'Radial Velocity', 'Radial Velocity', 'Radial Velocity', // ~30% RV
  'Microlensing',                                          // ~10%
  'Imaging',                                               // ~5%
  'TTV',                                                   // ~5%
];

function generate(): Planet[] {
  const rng = mulberry32(0xC0DE_5E1F);
  const out: Planet[] = [];

  for (let i = 0; i < 250; i++) {
    const method = pick(METHODS, rng);

    // Discovery year skewed toward recent.
    const yearRoll = rng() * rng();             // weights toward 0
    const discovery_year = 1995 + Math.floor((1 - yearRoll) * 29);

    // Host star: pick a stellar class with realistic temp.
    const stellarRoll = rng();
    let host_star_temp_k: number;
    if (stellarRoll < 0.55)      host_star_temp_k = 3000 + Math.floor(rng() * 800);   // M-dwarf
    else if (stellarRoll < 0.75) host_star_temp_k = 4000 + Math.floor(rng() * 1200);  // K
    else if (stellarRoll < 0.92) host_star_temp_k = 5200 + Math.floor(rng() * 1100);  // G (sun-like)
    else if (stellarRoll < 0.98) host_star_temp_k = 6300 + Math.floor(rng() * 1700);  // F
    else                         host_star_temp_k = 8000 + Math.floor(rng() * 2000);  // A

    // Distance varies with method bias (RV/Transit/TTV are nearby; Microlensing is far).
    const farMethod = method === 'Microlensing' ? 1 : 0;
    const distance_pc = Math.exp(
      Math.log(method === 'Imaging' ? 50 : 4) + rng() * (farMethod ? 4 : 5)
    );

    // Orbital period (log-uniform).
    const period_log = Math.log10(0.5) + rng() * Math.log10(50000 / 0.5);
    const orbital_period_d = Math.pow(10, period_log);

    // Semi-major axis from period (Kepler's 3rd law, solar mass approx).
    const semi_major_axis_au = Math.pow(orbital_period_d / 365.25, 2 / 3);

    // Mass: heavily skewed toward giants for RV, smaller for Transit.
    let mass_earth: number;
    if (method === 'Radial Velocity' || method === 'Imaging') {
      mass_earth = Math.pow(10, 1 + rng() * 3.5);   // 10..3000 Earth (1..10 Jupiter)
    } else {
      const r = rng();
      if (r < 0.5)       mass_earth = Math.pow(10, -1 + rng() * 1.5);  // sub-Earth..super-Earth
      else if (r < 0.85) mass_earth = Math.pow(10, 0.5 + rng() * 1.5); // mini-Neptune..Neptune
      else               mass_earth = Math.pow(10, 2 + rng() * 1.5);   // gas giant
    }
    mass_earth = Math.min(6000, Math.max(0.1, mass_earth));

    // Radius from mass via mass-radius relation, with scatter.
    let radius_earth: number;
    if (mass_earth < 2)       radius_earth = Math.pow(mass_earth, 0.27) * (0.95 + 0.1 * randn(rng) * 0.4);
    else if (mass_earth < 50) radius_earth = Math.pow(mass_earth, 0.59) * (0.85 + 0.1 * randn(rng) * 0.4);
    else                      radius_earth = 11 + randn(rng) * 2;
    radius_earth = Math.min(25, Math.max(0.5, radius_earth));

    // Equilibrium temp: depends on host T and orbital distance.
    const eq_temp_k = Math.min(3500, Math.max(50,
      host_star_temp_k * Math.pow(2 / Math.max(0.005, semi_major_axis_au), 0.5) * 0.07
      + randn(rng) * 30,
    ));

    out.push({
      name: nameOf(i, host_star_temp_k, method),
      discovery_year,
      discovery_method: method,
      distance_pc: round(distance_pc, 1),
      mass_earth: round(mass_earth, 2),
      radius_earth: round(radius_earth, 2),
      orbital_period_d: round(orbital_period_d, 2),
      host_star_temp_k: Math.round(host_star_temp_k),
      semi_major_axis_au: round(semi_major_axis_au, 4),
      eq_temp_k: Math.round(eq_temp_k),
    });
  }

  return out;
}

function nameOf(i: number, temp: number, method: Planet['discovery_method']): string {
  // Synthetic but plausible name. Real archive has names like "Kepler-22 b",
  // "TRAPPIST-1 e", "HD 209458 b" etc.
  const prefix =
    method === 'Microlensing' ? 'OGLE-' :
    method === 'Imaging'      ? 'GJ-'   :
    temp < 4000               ? 'TRAPPIST-' :
    temp < 5500               ? 'TOI-' :
                                'HD-';
  const idx = 100 + i;
  const letter = String.fromCharCode(98 + (i % 5)); // b,c,d,e,f
  return `${prefix}${idx} ${letter}`;
}

function round(n: number, decimals: number): number {
  const k = Math.pow(10, decimals);
  return Math.round(n * k) / k;
}

// ---------------------------------------------------------------------------
// Public dataset
// ---------------------------------------------------------------------------

export const PLANETS: readonly Planet[] = generate();
