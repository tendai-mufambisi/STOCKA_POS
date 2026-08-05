// Report palette.
//
// Chosen against one constraint that is easy to forget: these reports get
// printed, often on an office laser printer, in black and white. A palette that
// only works in colour produces a chart where every series is the same grey.
//
// So the categorical colours are ordered by LUMINANCE as well as hue — adjacent
// series stay distinguishable when the colour is thrown away. Verified by
// converting each to greyscale and checking the steps are visible.
//
// Backgrounds stay near-white: a full-bleed dark panel costs a shop several
// cents of toner per page and looks cheap when the cartridge is low.

const PALETTE = {
  ink: '#1a1d21',
  inkMuted: '#5b636e',
  inkFaint: '#8a929c',
  rule: '#dfe3e8',
  ruleFaint: '#eef1f4',
  paper: '#ffffff',
  panel: '#f7f9fa',

  // Semantic
  positive: '#1f7a4d',
  negative: '#b3261e',
  caution: '#8a6314',
  accent: '#2f4f8f',

  // Categorical, luminance-stepped so they survive greyscale printing.
  series: [
    '#2f4f8f', // deep blue      L~34
    '#7aa5d2', // light blue     L~65
    '#1f7a4d', // green          L~44
    '#9cc4a8', // pale green     L~75
    '#8a5a2b', // brown          L~42
    '#c9a227', // ochre          L~68
    '#6b4d8f', // purple         L~38
    '#b39ccc', // lilac          L~70
  ],
}

const seriesColour = (i) => PALETTE.series[i % PALETTE.series.length]

module.exports = { PALETTE, seriesColour }
