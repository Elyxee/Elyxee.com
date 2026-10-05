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

export function createDepthLens(burnLayer, portraitLayer) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('aria-hidden','true');
  svg.style.cssText = 'position:fixed;width:0;height:0;pointer-events:none';
  const defs = document.createElementNS(NS,'defs'); svg.append(defs);
  const inscriptions = document.createElement('div');
  inscriptions.className = 'stage-inscriptions';
  inscriptions.setAttribute('aria-hidden','true');
  document.body.append(svg, inscriptions);
  const filters = ['burn','portrait'].map(name => {
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
    return {filter,image,displacement,active:false,scale:null};
  });
  let longest = 1;
  function resize() {
    const w=innerWidth,h=innerHeight; longest=Math.max(w,h);
    const map=document.createElement('canvas'); map.width=map.height=256;
    const ctx=map.getContext('2d'); const pixels=ctx.createImageData(256,256);
    for(let y=0;y<256;y++) for(let x=0;x<256;x++) {
      const i=(y*256+x)*4;
      pixels.data[i]=depthChannel(x/255,w/longest);
      pixels.data[i+1]=depthChannel(y/255,h/longest);
      pixels.data[i+2]=128; pixels.data[i+3]=255;
    }
    ctx.putImageData(pixels,0,0);
    const url=map.toDataURL();
    filters.forEach(({filter,image,displacement})=>{
      // Bind every primitive to the same viewport-sized sampling surface.
      // Canvas padding outside the screen must not expand or offset it.
      for(const primitive of [filter,image,displacement]) {
        primitive.setAttribute('x','0'); primitive.setAttribute('y','0');
        primitive.setAttribute('width',w); primitive.setAttribute('height',h);
      }
      image.setAttribute('href',url);
    });
  }
  resize(); window.addEventListener('resize',resize,{passive:true});
  function apply(element,amount,index) {
    const active=amount>.0005, entry=filters[index];
    if(active!==entry.active) {
      entry.active=active;
      const filter=active ? `url(#depth-${index ? 'portrait' : 'burn'})` : '';
      element.style.filter=filter;
      if(!index) inscriptions.style.filter=filter;
    }
    const scale=(longest*amount).toFixed(3);
    if(active && entry.scale!==scale) {
      entry.scale=scale;
      entry.displacement.setAttribute('scale',scale);
    }
  }
  return {
    mountInscriptions() {
      document.querySelectorAll('.burn-mark__material').forEach(canvas=>inscriptions.append(canvas));
    },
    set(burnAmount,portraitAmount) { apply(burnLayer,burnAmount,0); apply(portraitLayer,portraitAmount,1); },
    destroy() {
      window.removeEventListener('resize',resize);
      [...inscriptions.children].forEach(canvas=>document.body.append(canvas));
      inscriptions.remove(); svg.remove(); burnLayer.style.filter=''; portraitLayer.style.filter='';
    },
  };
}
