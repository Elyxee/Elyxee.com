// A full-bleed optical pull-back: the centre recedes while the outer image
// stretches smoothly to the viewport. Boundaries stay inside the source,
// including after 8-bit quantization, so no rectangular background is exposed.
const NS = 'http://www.w3.org/2000/svg';

export function depthOffset(position) {
  const q = position * 2 - 1;
  return (position - .5) * (1 - q*q*q*q);
}

export function depthChannel(position, axisFraction) {
  // Neutral 0.5 is between two 8-bit values. Bias the perimeter inward by
  // half a texel instead of sampling outside the source on the bottom/right.
  const inward = (1 - 2 * position) / 510;
  return Math.round(255 * (.5 + depthOffset(position) * axisFraction + inward));
}

// The largest shift any field texel asks for, as a share of the filter scale.
const MAX_SHIFT = Math.max(...Array.from({ length: 256 }, (_, i) => Math.abs(depthChannel(i / 255, 1) / 255 - .5)));

/** How far, in CSS pixels, the pull-back can move any pixel at this scale. */
export function depthReach(scale) {
  return Math.ceil(scale * MAX_SHIFT) + 2;
}

// Every displaced element is a fixed, full-viewport box, so all filters share
// one coordinate space and one viewport-sized field. The work a filter costs
// follows the area of its region, so each region covers only what can be seen
// of its element: the burn scene above the fire seam, the portrait below it,
// and each inscription where it is drawn. A pixel inside a region is computed
// exactly as with a full-viewport region when the region's edges lie on the
// field's texel grid and extend past the visible part by the largest shift
// (its samples then stay inside it).
export function createDepthLens(burnLayer, portraitLayer) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('aria-hidden','true');
  svg.style.cssText = 'position:fixed;width:0;height:0;pointer-events:none';
  const defs = document.createElementNS(NS,'defs'); svg.append(defs);
  const inscriptions = document.createElement('div');
  inscriptions.className = 'stage-inscriptions';
  inscriptions.setAttribute('aria-hidden','true');
  document.body.append(svg, inscriptions);
  const setRect = (element, [x, y, width, height]) => {
    for (const [key, value] of [['x',x],['y',y],['width',width],['height',height]]) {
      const text = String(value);
      if (element.getAttribute(key) !== text) element.setAttribute(key, text);
    }
  };
  function makeLens(name, element) {
    const filter = document.createElementNS(NS,'filter');
    filter.id = `depth-${name}`;
    for (const [key,value] of Object.entries({x:0,y:0,filterUnits:'userSpaceOnUse',primitiveUnits:'userSpaceOnUse', 'color-interpolation-filters':'sRGB'}))
      filter.setAttribute(key,value);
    const image = document.createElementNS(NS,'feImage');
    image.setAttribute('result','field'); image.setAttribute('preserveAspectRatio','none');
    image.setAttribute('x','0'); image.setAttribute('y','0');
    const displacement = document.createElementNS(NS,'feDisplacementMap');
    for (const [key,value] of Object.entries({in:'SourceGraphic',in2:'field',scale:0,xChannelSelector:'R',yChannelSelector:'G'}))
      displacement.setAttribute(key,value);
    filter.append(image,displacement); defs.append(filter);
    return { element, filter, image, displacement };
  }
  const lenses = [makeLens('burn', burnLayer), makeLens('portrait', portraitLayer)];
  // Each inscription sits in its own full-viewport wrapper with its own lens;
  // `box` is where it draws, measured each time its lens switches on.
  const marks = [];
  const groups = [
    { lenses: () => [lenses[0], ...marks], active: false, scale: null, amount: 0 },
    { lenses: () => [lenses[1]], active: false, scale: null, amount: 0 },
  ];
  let width = 1, height = 1, longest = 1, field = '';

  function resize() {
    width=innerWidth; height=innerHeight; longest=Math.max(width,height);
    const map=document.createElement('canvas'); map.width=map.height=256;
    const ctx=map.getContext('2d'); const pixels=ctx.createImageData(256,256);
    for(let y=0;y<256;y++) for(let x=0;x<256;x++) {
      const i=(y*256+x)*4;
      pixels.data[i]=depthChannel(x/255,width/longest);
      pixels.data[i+1]=depthChannel(y/255,height/longest);
      pixels.data[i+2]=128; pixels.data[i+3]=255;
    }
    ctx.putImageData(pixels,0,0);
    field=map.toDataURL();
    // Bind every field to the same viewport-sized sampling surface. Canvas
    // padding outside the screen must not expand or offset it.
    for (const lens of [...lenses, ...marks]) {
      setRect(lens.image, [0, 0, width, height]);
      lens.image.setAttribute('href', field);
      lens.region = null;
      lens.box = null;
    }
    groups.forEach(group => { group.scale = null; });
  }
  resize(); window.addEventListener('resize',resize,{passive:true});

  function place(lens, [x, y, w, h]) {
    const tx = width / 256, ty = height / 256;
    const left = Math.floor(x / tx) * tx, top = Math.floor(y / ty) * ty;
    const region = [left, top, Math.ceil((x + w) / tx) * tx - left, Math.ceil((y + h) / ty) * ty - top];
    const key = region.join();
    if (lens.region === key) return;
    lens.region = key;
    setRect(lens.filter, region);
    setRect(lens.displacement, region);
  }

  // `seam` is the vertical extent [top, bottom] of the fire seam as viewport
  // fractions, or null when no seam divides the screen.
  function apply(index, amount, seam) {
    const group = groups[index], active = amount > .0005;
    if (active !== group.active) {
      group.active = active;
      for (const lens of group.lenses()) {
        lens.box = null;
        lens.element.style.filter = active ? `url(#${lens.filter.id})` : '';
      }
    }
    if (!active) return;
    const scale = (longest*amount).toFixed(3);
    if (group.scale !== scale) {
      group.scale = scale;
      for (const lens of group.lenses()) lens.displacement.setAttribute('scale', scale);
    }
    const reach = depthReach(+scale);
    // Burn above the seam, portrait below it; the whole viewport otherwise.
    const top = index && seam ? Math.max(0, seam[0] * height - reach) : 0;
    const bottom = !index && seam ? Math.min(height, seam[1] * height + reach) : height;
    for (const lens of group.lenses()) {
      if (lens.canvas && !lens.box) {
        const r = lens.canvas.getBoundingClientRect();
        lens.box = [r.left, r.top, r.right, r.bottom];
      }
      if (lens.box) {
        const [left, boxTop, right, boxBottom] = lens.box;
        place(lens, [left - reach, boxTop - reach, right - left + 2 * reach, boxBottom - boxTop + 2 * reach]);
      } else {
        place(lens, [0, top, width, Math.max(0, bottom - top)]);
      }
    }
  }
  return {
    mountInscriptions() {
      document.querySelectorAll('.burn-mark__material').forEach((canvas, i) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'stage-inscriptions__mark';
        wrapper.append(canvas);
        inscriptions.append(wrapper);
        const mark = Object.assign(makeLens(`mark-${i}`, wrapper), { canvas, box: null });
        setRect(mark.image, [0, 0, width, height]);
        mark.image.setAttribute('href', field);
        marks.push(mark);
      });
    },
    set(burnAmount, portraitAmount, seam = null) { apply(0, burnAmount, seam); apply(1, portraitAmount, seam); },
    destroy() {
      window.removeEventListener('resize',resize);
      marks.forEach(mark => document.body.append(mark.canvas));
      inscriptions.remove(); svg.remove(); burnLayer.style.filter=''; portraitLayer.style.filter='';
    },
  };
}
