/**
 * Fictional grid. Every name and 3-letter code is invented; none belongs to a
 * real driver or team, and the colours are plain hues rather than liveries.
 */
export interface Driver {
  name: string;
  code: string;
  color: string;
}

export const DRIVERS: Driver[] = [
  { name: 'Luca Ferrandi', code: 'FER', color: '#e8384f' },
  { name: 'Joris Veltmans', code: 'VEL', color: '#ff9f1a' },
  { name: 'Kenji Mutsuhara', code: 'MUT', color: '#f5e03a' },
  { name: 'Dario Calzetti', code: 'CAL', color: '#2bd67b' },
  { name: 'Elias Brandvold', code: 'BRA', color: '#25d0ff' },
  { name: 'Tomas Ibarrola', code: 'IBA', color: '#4d7cff' },
  { name: 'Niko Sarvela', code: 'SVL', color: '#b77dff' },
  { name: 'Rafael Quintero', code: 'QUI', color: '#ff6fb5' },
  { name: 'Anders Holmqvist', code: 'HOL', color: '#9be15d' },
  { name: 'Pavel Dorokhin', code: 'DOR', color: '#d9d9d9' },
  { name: 'Jonas Ekeland', code: 'EKE', color: '#00b8a9' },
  { name: 'Marco Pellegrin', code: 'PEL', color: '#c47a3d' },
];

export const PLAYER_DRIVER: Driver = { name: 'You', code: 'YOU', color: '#ffffff' };
