import { createOpeningGeometry } from './opening-geometry.js?v=4';
import { loadImage } from '../shared/load-image.js';

import { FIRE_EDGE, FRONT_GLSL } from './transition-front.js?v=2';
export { FIRE_EDGE, edgeHeightAt } from './transition-front.js?v=2';
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const VS=`attribute vec2 aPos; varying vec2 vUv;
void main(){vUv=aPos*.5+.5;gl_Position=vec4(aPos,0.,1.);}`;
const FS=`
precision highp float;
varying vec2 vUv;
uniform vec2 uRes;
uniform sampler2D uFuel, uGeometry;
uniform float uTime,uEdge,uMode,uBias,uDim,uLife,uOpening,uReveal,uTextureReady;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*noise(p);p=mat2(.8,-.6,.6,.8)*p*2.03+vec2(1.7,9.2);a*=.5;}return v;}
vec2 mirrored(vec2 p){return 1.-abs(mod(p,2.)-1.);}
vec2 cover(vec2 uv){float a=uRes.x/uRes.y;vec2 s=vec2(1.);
if(a<1.7777778)s.x=a/1.7777778;else s.y=1.7777778/a;return (uv-.5)*s+.5;}
vec3 fuel(vec2 uv,float t){
  // Two overlapping advection phases hide the reset. Curl fields deform the
  // fine combustion texture instead of stretching low-frequency orange blobs.
  vec2 flow=vec2(fbm(uv*5.+vec2(0,-t*.13)),fbm(uv*5.+vec2(9.3,-t*.16)))-.5;
  uv+=flow*.075;
  float phase=fract(t*.055),next=fract(phase+.5);
  vec2 velocity=vec2(.11,-.20)+flow*.13;
  vec3 a=texture2D(uFuel,mirrored(uv+velocity*phase)).rgb;
  vec3 b=texture2D(uFuel,mirrored(uv+velocity*next)).rgb;
  vec3 color=mix(a,b,abs(phase*2.-1.));
  float heat=fbm(uv*9.+vec2(0,-t*.3));
  vec3 fallback=mix(vec3(.022,.011,.008),vec3(.64,.19,.028),smoothstep(.36,.77,heat));
  color=mix(fallback,color,uTextureReady);
  float l=dot(color,vec3(.21,.72,.07));
  color=mix(color,vec3(l),.12)*vec3(.96,.90,.84);
  return color*(.86+.2*heat);
}
float stars(vec2 uv,float density,float seed){
  vec2 p=uv*vec2(uRes.x/uRes.y,1.)*density;
  vec2 cell=floor(p),f=fract(p)-vec2(hash(cell+seed),hash(cell+seed+8.));
  float point=exp(-dot(f,f)*1600.);
  return point*step(.982,hash(cell+seed+21.))*(.45+.3*sin(uTime*.45+hash(cell)*30.));
}
vec4 opening(vec2 uv){
  vec2 auv=cover(uv),art=vec2(auv.x,1.-auv.y)*vec2(1920,1080);
  vec3 geo=texture2D(uGeometry,auv).rgb;
  // The apparition is a lit volume of white vapour, with no dark body or
  // outlined coat. Its tiny drift settles back into the painted silhouette.
  float drift=1.-smoothstep(.12,.62,uReveal);
  vec2 vapour=vec2(fbm(art*.018+vec2(uTime*.10,0.)),fbm(art*.024+vec2(7.,-uTime*.12)))-.5;
  vec2 spiritUv=auv+(vapour*16.+vec2(sin(uTime*.63)*2.,sin(uTime*.8)*3.))*vec2(1./1920.,1./1080.)*drift;
  float spirit=texture2D(uGeometry,spiritUv).r;
  float halo=texture2D(uGeometry,spiritUv+vec2(.004,.003)).r
    +texture2D(uGeometry,spiritUv-vec2(.004,.003)).r
    +texture2D(uGeometry,spiritUv+vec2(-.003,.007)).r;
  float mist=fbm(art*.042+vapour*2.+vec2(uTime*.04,-uTime*.32));
  float silk=fbm(art*vec2(.027,.012)+vec2(uTime*.08,-uTime*.19));
  float hem=1.-smoothstep(728.,820.,art.y+(mist-.5)*58.);
  float soul=spirit*(.13+.78*smoothstep(.20,.72,mist)+.16*silk)*hem;
  // A soft displaced echo peels away into vapour instead of tracing a coat.
  float wisp=texture2D(uGeometry,spiritUv+vec2(sin(art.y*.028-uTime*.4)*.004,-.012)).r;
  wisp*=smoothstep(.40,.72,silk)*.12*drift;
  vec2 q=(art-vec2(1010,354))/vec2(635,386);
  float billow=fbm(art*.004+vec2(uTime*.03,-uTime*.085));
  float body=1.-smoothstep(.57,1.08,length(q)+(billow-.5)*.66);
  float curl=fbm(art*.012+vec2(0,-uTime*.18));
  body*=smoothstep(.16,.52,curl+.2);
  vec3 combustion=fuel(auv*1.12+vec2(.02,0),uTime);
  float breath=.9+.1*sin(uTime*.85);
  vec3 col=vec3(.002,.004,.007);
  float star=stars(uv,110.,2.)+stars(uv,63.,19.)*.6;
  col+=vec3(.59,.68,.73)*star*(1.-body);
  // Smoke has a soft irregular boundary; the traveller remains in front of it.
  col+=combustion*body*breath*(.65+.35*uLife);
  col+=vec3(.16,.048,.009)*exp(-length(q)*2.9)*.14;
  col*=1.-spirit*.12;
  col+=vec3(.99,1.,1.)*(soul+halo*.035+wisp);
  col+=geo.b*vec3(.26,.32,.34);
  // The source-aligned spirit becomes the painted person first. The rest of
  // the landscape resolves outward through a soft, irregular exposure field.
  float field=length((art-vec2(760,640))/vec2(1540,1120))*.65+fbm(art*.005)*.24;
  float revealed=smoothstep(field-.16,field+.16,uReveal*1.65-.3);
  float alpha=1.-revealed;
  col*=.96+.08*hash(gl_FragCoord.xy);
  return vec4(col*alpha,alpha);
}
${FRONT_GLSL}
vec4 surfaceOver(vec4 under,vec3 color,float opacity){
  float a=clamp(opacity,0.,1.);
  return vec4(color*a+under.rgb*(1.-a),a+under.a*(1.-a));
}
void main(){
  if(uOpening>.5){gl_FragColor=opening(vUv);return;}
  vec2 uv=vUv,p=vec2(uv.x*uRes.x/uRes.y,uv.y);
  float t=uTime,h=paperHeight(uv.x,uEdge,uBias,t);
  float d=h-uv.y; // negative: the remaining sheet; positive: the exposed scene
  float settle=smoothstep(-.34,-.12,uEdge)*(1.-smoothstep(1.06,1.34,uEdge));
  float grain=noise(p*vec2(310.,420.));
  float fibre=noise(p*vec2(170.,780.));
  float root=paperNoise(uv.x*91.+uEdge*7.);
  vec2 flow=vec2(fbm(p*7.+vec2(0.,-t*.31)),fbm(p*7.+vec2(9.,-t*.23)))-.5;
  vec4 result=vec4(0.);

  // The warm face of the parchment darkens before the fire reaches it. A
  // narrow, cracked carbon edge stays attached to the surviving picture.
  float sheet=1.-smoothstep(-.0015,.0015,d);
  float ahead=max(-d,0.);
  float scorch=(1.-smoothstep(.012,.070+(root-.5)*.024,ahead))*sheet;
  result=surfaceOver(result,vec3(.085,.036,.012),scorch*.55);
  float charred=(1.-smoothstep(.003,.026+(grain-.5)*.012,ahead))*sheet;
  float crack=pow(1.-abs(fibre*2.-1.),11.)*smoothstep(.52,.79,grain);
  vec3 carbon=vec3(.009,.007,.006)+vec3(.043,.032,.020)*grain;
  carbon+=vec3(.24,.075,.009)*crack*exp(-ahead*110.);
  result=surfaceOver(result,carbon,charred*.97);

  // Small curled flakes cast a close shadow onto Space, placing that scene
  // visibly underneath the burning sheet instead of beside a flat wipe.
  float exposed=smoothstep(0.,.005,d);
  float shadow=exp(-max(d-.003,0.)*65.)*exposed*(.27+.25*root);
  result=surfaceOver(result,vec3(.009,.007,.006),shadow);
  float curl=(1.-smoothstep(.002,.012,abs(d-.0025)))
    *smoothstep(.37,.74,paperNoise(uv.x*149.+uEdge*9.));
  result=surfaceOver(result,vec3(.027,.023,.018)+grain*.025,curl*.86);
  float ashLip=exp(-abs(d+.004)*480.)*smoothstep(.57,.82,fibre);
  result=surfaceOver(result,vec3(.26,.19,.11),ashLip*.5);

  // Flames grow from the actual torn edge and climb onto the unburned sheet.
  // Curling hot gas, translucent tips and dense roots replace the broad cloud.
  float rise=max(-d,0.);
  vec2 plumeUv=vec2(p.x*11.,p.y*17.-t*1.25);
  float curlField=fbm(plumeUv+flow*3.);
  float gas=fbm(plumeUv*1.7+vec2(curlField*2.3,-t*.45));
  float envelope=1.-smoothstep(.004,.18,rise);
  float lift=smoothstep(-.014,.006,-d);
  float tongue=smoothstep(.37,.76,gas*.75+curlField*.35+envelope*.32);
  float flame=tongue*envelope*lift;
  float ignition=exp(-abs(d)*180.)*smoothstep(.40,.82,root);
  vec3 combustion=fuel(vec2(uv.x,uv.y*.86)+flow*.055,t*1.18);
  vec3 flameColor=combustion*(1.40+flame*.75);
  flameColor+=vec3(.25,.10,.019)*pow(flame,3.);
  flameColor*=1.-uMode*.18;
  result=surfaceOver(result,flameColor,flame*.83);
  result.rgb+=flameColor*flame*.17;
  float hotLip=exp(-abs(d+.001)*510.)*(.035+.95*pow(root,1.8));
  result.rgb+=vec3(1.,.32,.035)*hotLip*.58+vec3(1.,.74,.36)*ignition*.10;
  result.a=clamp(result.a+hotLip*.22,0.,1.);

  // The same light spills onto the newly exposed portrait, then cool smoke
  // thins into the star field. Both sides share one short-lived atmosphere.
  float smokeField=fbm(p*vec2(9.,17.)+flow*2.+vec2(t*.10,-t*.26));
  float smoke=exp(-abs(d)*8.)*smoothstep(.21,.66,smokeField)*.48;
  float wake=exp(-max(d,0.)*8.)*exposed;
  smoke+=wake*(.07+.24*smoothstep(.22,.64,smokeField));
  smoke*=1.-flame*.7;
  vec3 smokeColor=mix(vec3(.16,.105,.062),vec3(.073,.078,.083),smoothstep(.01,.19,d));
  result=surfaceOver(result,smokeColor,smoke);
  float reflection=exp(-max(d,0.)*10.)*exposed*(.075+.10*root);
  result.rgb+=vec3(.65,.31,.12)*reflection;

  // A few detached flecks fall into the revealed scene, going from orange to
  // ash. They are local to the seam and disappear before the page has settled.
  vec2 cells=vec2(p.x*125.+sin(p.y*13.+t*.7)*.35,(p.y+t*.033)*125.);
  vec2 cell=floor(cells),local=fract(cells)-.5;
  float flake=step(.991,hash(cell))*exp(-dot(local*vec2(1.,1.8),local*vec2(1.,1.8))*38.);
  flake*=smoothstep(-.025,.02,d)*(1.-smoothstep(.08,.24,d));
  vec3 ember=mix(vec3(.95,.36,.055),vec3(.28,.25,.21),smoothstep(.01,.13,d));
  result=surfaceOver(result,ember,flake*.7);
  result.rgb+=ember*flake*.12;

  result*=settle;
  result.rgb*=.97+.06*hash(gl_FragCoord.xy+floor(t*12.));
  result.a+=uDim*(1.-result.a);
  gl_FragColor=vec4(clamp(result.rgb,0.,1.),clamp(result.a,0.,1.));
}`;

function shader(gl,type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);
if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;}
// `opening: false` is for curtains that never play the site opening: they skip
// its reconstructed geometry and the early texture preview.
export function createFireCurtain({dprCap=1.25,opening=true}={}) {
  const canvas=document.createElement('canvas');canvas.id='stage-fire';canvas.setAttribute('aria-hidden','true');document.body.append(canvas);
  const state={edge:FIRE_EDGE.hidden,mode:0,bias:1,dim:0,life:1,opening:0,reveal:0};
  let visible=false;
  const gl=canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:false,depth:false,stencil:false,powerPreference:'high-performance'});
  if(!gl){
    canvas.remove();const sheet=document.createElement('div');sheet.id='stage-fire';sheet.className='stage-fire--fallback';document.body.append(sheet);
    return {element:sheet,state,supported:false,ready:Promise.resolve(),get visible(){return visible;},set(s){Object.assign(state,s);},
      render(){const progress=clamp((state.edge-FIRE_EDGE.hidden)/(FIRE_EDGE.full-FIRE_EDGE.hidden),0,1);const a=state.opening?1-state.reveal:Math.sin(progress*Math.PI)*.55;visible=a>.001;sheet.classList.toggle('is-live',visible);sheet.style.setProperty('--fire-cover',a);},
      resize(){},destroy(){sheet.remove();}};
  }
  const program=gl.createProgram(),vs=shader(gl,gl.VERTEX_SHADER,VS),fs=shader(gl,gl.FRAGMENT_SHADER,FS);
  gl.attachShader(program,vs);gl.attachShader(program,fs);gl.bindAttribLocation(program,0,'aPos');gl.linkProgram(program);
  gl.deleteShader(vs);gl.deleteShader(fs);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
  const names=['uRes','uTime','uEdge','uMode','uBias','uDim','uLife','uOpening','uReveal','uFuel','uGeometry','uTextureReady'];
  const uniforms=Object.fromEntries(names.map(n=>[n,gl.getUniformLocation(program,n)]));
  const textures=[];
  function texture(unit,source){const tex=gl.createTexture();textures.push(tex);gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
    if(source)gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
    else gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([30,10,3,255]));
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return tex;}
  const fuelTexture=texture(0);texture(1,opening?createOpeningGeometry():null);
  gl.uniform1i(uniforms.uFuel,0);gl.uniform1i(uniforms.uGeometry,1);
  let textureReady=0,destroyed=false,fullTextureReady=false;
  function upload(source){
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,fuelTexture);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);textureReady=1;
  }
  // The same artwork supplies an early preview while the full-resolution,
  // pixel-identical texture is in flight. A late preview never replaces it.
  if(opening)loadImage(new URL('../../Assets/optimized/combustion-preview.webp',import.meta.url).href,
    {fetchPriority:'high'}).then(source=>{
      if(!destroyed&&!fullTextureReady)upload(source);
    }).catch(()=>{});
  const ready=loadImage(new URL('../../Assets/optimized/combustion.webp',import.meta.url).href,{
    fallbackSrc:new URL('../../Assets/Transitions/combustion-cloud.png',import.meta.url).href,
    fetchPriority:'high',
  }).then(source=>{
    if(!destroyed){upload(source);fullTextureReady=true;}
  });
  let width=1,height=1;
  function resize(){const dpr=Math.min(devicePixelRatio||1,dprCap);width=Math.max(1,Math.round(innerWidth*dpr));height=Math.max(1,Math.round(innerHeight*dpr));canvas.width=width;canvas.height=height;gl.viewport(0,0,width,height);}
  resize();window.addEventListener('resize',resize,{passive:true});
  return {element:canvas,state,supported:true,ready,get visible(){return visible;},set(s){Object.assign(state,s);},
    render(time){const show=state.opening?state.reveal<1:state.edge>FIRE_EDGE.hidden+.005&&state.edge<FIRE_EDGE.full-.005;
      if(show!==visible){visible=show;canvas.classList.toggle('is-live',show);if(!show)gl.clear(gl.COLOR_BUFFER_BIT);}
      if(!show)return;gl.useProgram(program);gl.uniform2f(uniforms.uRes,width,height);gl.uniform1f(uniforms.uTime,time);gl.uniform1f(uniforms.uTextureReady,textureReady);
      for(const name of ['edge','mode','bias','dim','life','opening','reveal'])gl.uniform1f(uniforms['u'+name[0].toUpperCase()+name.slice(1)],state[name]);
      gl.drawArrays(gl.TRIANGLES,0,3);
    },resize,destroy(){destroyed=true;window.removeEventListener('resize',resize);textures.forEach(t=>gl.deleteTexture(t));gl.deleteBuffer(buffer);gl.deleteProgram(program);canvas.remove();}};
}
