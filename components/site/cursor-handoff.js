// The scene cursors remain the only cursor shapes. A few short-lived grains
// carry their warm/cool light through the smoke; no second lens, orbit or ring.
const rand=(a,b)=>a+Math.random()*(b-a);
export function createCursorHandoff() {
  const canvas=document.createElement('canvas');canvas.id='stage-cursor';canvas.setAttribute('aria-hidden','true');document.body.append(canvas);
  const ctx=canvas.getContext('2d',{alpha:true,desynchronized:true});
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const pointer={x:-1e4,y:-1e4,seen:false},motes=[];
  let width=1,height=1,painted=false;
  function resize(){width=innerWidth;height=innerHeight;const dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx?.setTransform(dpr,0,0,dpr,0,0);}
  resize();window.addEventListener('resize',resize,{passive:true});
  return {canvas,pointer,
    setPointer(x,y){pointer.x=x;pointer.y=y;pointer.seen=true;},
    burst({cold=false}={}){
      if(!ctx||!pointer.seen||reduced.matches)return;
      // World-space emission at the actual pointer. Existing grains stay put
      // and dissolve, rather than orbiting a separate lagging cursor centre.
      for(let i=0;i<9;i++)motes.push({x:pointer.x+rand(-3,3),y:pointer.y+rand(-3,3),vx:rand(-12,12),vy:rand(-32,-9),age:0,life:rand(.35,.7),size:rand(.45,1.1),color:cold?'169,185,189':'206,143,78'});
    },
    update(dt){for(let i=motes.length-1;i>=0;i--){const p=motes[i];p.age+=dt;if(p.age>=p.life){motes.splice(i,1);continue;}p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=Math.exp(-dt*2);}},
    render(){if(!ctx||(!motes.length&&!painted))return;ctx.clearRect(0,0,width,height);painted=motes.length>0;
      for(const p of motes){const opacity=Math.pow(1-p.age/p.life,1.8)*.65;ctx.fillStyle=`rgba(${p.color},${opacity})`;ctx.shadowColor=`rgba(${p.color},${opacity*.4})`;ctx.shadowBlur=3;ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,Math.PI*2);ctx.fill();}ctx.shadowBlur=0;},
    destroy(){window.removeEventListener('resize',resize);canvas.remove();},
  };
}
