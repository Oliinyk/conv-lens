// Mirrors PATH_MODES in src/paths.js: the dashboard is served as static files and cannot
// import from the server bundle.
export const PATH_MODES = [
  ['noise', 'прибирати технічні параметри (v, utm, fbclid…)'],
  ['all', 'прибирати всі параметри після ?'],
  ['keep', 'лишати адресу як є']
];
