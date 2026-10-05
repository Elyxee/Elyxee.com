const clamp = value => Math.max(0, Math.min(1, value));
const smoothstep = (a, b, value) => { const t = clamp((value-a)/(b-a)); return t*t*(3-2*t); };
export const FIRE_EDGE = Object.freeze({ hidden: -.34, full: 1.34 });

// The page reveal and the fire share the same moving seam. New scenery is
// already behind the passing smoke; the fire never has to retreat a second time.
export function edgeHeightAt(x, edge, bias = 1, time = 0) {
  const crossing = smoothstep(-.3,.08,edge) * (1-smoothstep(.75,1.35,edge));
  const wave = Math.sin(x*7.1+time*.45+edge*3)*.026 + Math.sin(x*17.3-time*.62)*.014;
  return edge + crossing * (bias*(.26*smoothstep(.25,1,x)-.06*(1-x)) + wave);
}

// Surface detail only: the broad front and the area used for settling keep
// their existing motion. These small tears give the revealed sheet a material
// edge, shared exactly by the clip and the combustion shader.
function paperNoise(value) {
  const cell = Math.floor(value), f = value-cell, t = f*f*(3-2*f);
  const hash = n => { const m=((n%251)+251)%251; const h=(m*34+1)*m/251; return h-Math.floor(h); };
  return hash(cell)*(1-t)+hash(cell+1)*t;
}
export function paperEdgeHeightAt(x, edge, bias = 1, time = 0) {
  const fibres = (paperNoise(x*37+edge*4+9.2)-.5)*.032
    +(paperNoise(x*113+edge*8+31.7)-.5)*.013
    +(paperNoise(x*293+edge*13+5.3)-.5)*.004;
  return edgeHeightAt(x,edge,bias,time)+fibres;
}

export function portraitClip(edge, time) {
  const points = [];
  for (let i=0; i<=256; i++) {
    const x = i/256, y = clamp(1-paperEdgeHeightAt(x,edge,1,time));
    points.push(`${(x*100).toFixed(2)}% ${(y*100).toFixed(3)}%`);
  }
  return `polygon(${points.join(',')},100% 100%,0% 100%)`;
}

export function portraitShare(progress, time = 0) {
  const edge = FIRE_EDGE.hidden + (FIRE_EDGE.full-FIRE_EDGE.hidden)*progress;
  let area = 0;
  for (let i=0; i<40; i++) area += clamp(edgeHeightAt((i+.5)/40,edge,1,time));
  return area/40;
}

export const FRONT_GLSL = `
float frontHeight(float x,float edge,float bias,float time){
  float crossing=smoothstep(-.3,.08,edge)*(1.-smoothstep(.75,1.35,edge));
  float wave=sin(x*7.1+time*.45+edge*3.)*.026+sin(x*17.3-time*.62)*.014;
  return edge+crossing*(bias*(.26*smoothstep(.25,1.,x)-.06*(1.-x))+wave);
}
float paperHash(float n){float m=mod(n,251.);return fract((m*34.+1.)*m/251.);}
float paperNoise(float value){float c=floor(value),f=fract(value);f=f*f*(3.-2.*f);return mix(paperHash(c),paperHash(c+1.),f);}
float paperHeight(float x,float edge,float bias,float time){
  float fibres=(paperNoise(x*37.+edge*4.+9.2)-.5)*.032
    +(paperNoise(x*113.+edge*8.+31.7)-.5)*.013
    +(paperNoise(x*293.+edge*13.+5.3)-.5)*.004;
  return frontHeight(x,edge,bias,time)+fibres;
}`;
