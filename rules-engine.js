/* Geometry and combat rules. Distances use board pixels (20 per inch). */
const BattleRules = (() => {
    const EPS = 0.00001, SCALE = 20;
    const dot = (a, b) => a.x * b.x + a.y * b.y;
    const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
    function polygon(u) {
        const a = (u.angle || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
        const cx = u.x + u.w / 2, cy = u.y + u.h / 2;
        if (u.terrain) return Array.from({ length: 64 }, (_, i) => {
            const t = i * Math.PI / 32;
            return { x: cx + Math.cos(t) * u.w / 2, y: cy + Math.sin(t) * u.h / 2 };
        });
        return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y]) => ({
            x: cx + x*u.w/2*c - y*u.h/2*s, y: cy + x*u.w/2*s + y*u.h/2*c }));
    }
    function overlap(a, b, touching = false) {
        for (const p of [a,b]) for (let i=0; i<p.length; i++) {
            const d = sub(p[(i+1)%p.length], p[i]), axis = {x:-d.y,y:d.x};
            const aa = a.map(v=>dot(v,axis)), bb=b.map(v=>dot(v,axis));
            const gap = Math.max(Math.min(...aa),Math.min(...bb))-Math.min(Math.max(...aa),Math.max(...bb));
            if (touching ? gap > EPS : gap >= -EPS) return false;
        }
        return true;
    }
    const touches = (a,b) => overlap(polygon(a),polygon(b),true);
    const enemies = (u,units) => units.filter(v=>v.id!==u.id && v.owner!==u.owner && touches(u,v));
    const inTerrain = (u,terrain,types) => terrain.some(t=>types.includes(t.type)&&overlap(polygon(u),polygon(t)));
    function legalPosition(u, units, terrain, width=960, height=720, touching=false) {
        if (polygon(u).some(p=>p.x<=0 || p.y<=0 || p.x>=width || p.y>=height)) return false;
        return !units.some(v=>v.id!==u.id && overlap(polygon(u),polygon(v),touching)) &&
            !terrain.some(t=>['mountain','swamp'].includes(t.type)&&overlap(polygon(u),polygon(t),touching));
    }
    // Continuous swept SAT: returns the interval of contact, including narrow blockers.
    function sweep(a,b,velocity,touching=true) {
        let enter=-Infinity, exit=Infinity;
        for (const p of [a,b]) for(let i=0;i<p.length;i++) {
            const d=sub(p[(i+1)%p.length],p[i]), axis={x:-d.y,y:d.x};
            const aa=a.map(v=>dot(v,axis)), bb=b.map(v=>dot(v,axis)), speed=dot(velocity,axis);
            if(Math.abs(speed)<EPS) {
                const gap=Math.max(Math.min(...aa),Math.min(...bb))-Math.min(Math.max(...aa),Math.max(...bb));
                if(touching?gap>EPS:gap>=-EPS) return null;
            }
            else {
                const t1=(Math.min(...bb)-Math.max(...aa))/speed, t2=(Math.max(...bb)-Math.min(...aa))/speed;
                enter=Math.max(enter,Math.min(t1,t2)); exit=Math.min(exit,Math.max(t1,t2));
            }
        }
        return enter<=exit+EPS && exit>=0 && enter<=1 ? {enter,exit} : null;
    }
    function move(u, inches, backwards, ctx) {
        if (!Number.isFinite(inches)||inches<=0) throw Error('Enter a positive distance in inches.');
        if(enemies(u,ctx.units).length && u.owner!==ctx.master) throw Error('Only the Master Tactician can move a unit out of contact.');
        const act=ctx.activation, direction=backwards?'backwards':'forwards';
        if(act.direction && act.direction!==direction) throw Error('Keep the same forward or backward direction throughout this Move.');
        if(act.charged) throw Error('A charge stops on contact. Strike or finish the activation.');
        let limit=u.pace*(backwards?0.5:1);
        if(act.slowed) limit=Math.min(limit,4);
        if(act.distance+inches>limit+EPS) throw Error(`This Move has ${(Math.max(0,limit-act.distance)).toFixed(2)} inches left.`);
        const a=u.angle*Math.PI/180, length=inches*SCALE*(backwards?-1:1);
        let velocity={x:Math.sin(a)*length,y:-Math.cos(a)*length}, fraction=1, charged=false;
        const start=polygon(u);
        const collisions=[];
        for(const v of [...ctx.units.filter(v=>v.id!==u.id),...ctx.terrain.filter(t=>['swamp','mountain'].includes(t.type))]) {
            const enemy=!v.terrain&&v.owner!==u.owner;
            const hit=sweep(start,polygon(v),velocity,enemy);
            if(!hit || hit.exit<EPS) continue;
            // Moving away from an existing contact is permitted, never through it.
            if(hit.enter<0 && hit.exit<=EPS) continue;
            if(enemy && !touches(u,v) && !backwards && !act.movePivoted && hit.enter>=-EPS) {
                if(hit.enter<=fraction) { fraction=Math.max(0,hit.enter); charged=true; }
            } else collisions.push({hit,enemy});
        }
        if(collisions.some(({hit,enemy})=>enemy?hit.enter<=fraction+EPS:hit.enter<fraction-EPS)) throw Error('The path is blocked by a unit or impassable terrain. Stop before it.');
        const next={...u,x:u.x+velocity.x*fraction,y:u.y+velocity.y*fraction};
        if(!legalPosition(next,ctx.units,ctx.terrain)) throw Error('The unit must remain inside the battlefield without overlapping pieces.');
        const slowed=u.defence>4 && (act.slowed || ctx.terrain.some(t=>['forest','field'].includes(t.type)&&sweep(start,polygon(t),{x:velocity.x*fraction,y:velocity.y*fraction})));
        if(slowed && act.distance+inches*fraction>4+EPS) throw Error('Slowing terrain limits the entire Move to 4 inches.');
        return {unit:next,distance:act.distance+inches*fraction,direction,slowed,charged};
    }
    function pivot(u,degrees,ctx) {
        if(!Number.isFinite(degrees)||Math.abs(degrees)>90||Math.abs(degrees)<EPS) throw Error('A pivot must be between −90° and 90°, excluding zero.');
        if(enemies(u,ctx.units).length || ctx.activation.charged) throw Error('A unit in contact, or that charged this activation, cannot pivot.');
        if(ctx.activation.pivots>=u.mobility+(ctx.activation.action==='Extra Pivot'?1:0)) throw Error('No pivots remain. Choose Extra Pivot if your action is still available.');
        // Conservative swept envelope per half-degree interval; cannot miss a thin obstruction.
        const steps=Math.ceil(Math.abs(degrees)*2), radius=Math.hypot(u.w,u.h)/2;
        for(let i=0;i<=steps;i++) {
            const pad=radius*Math.abs(degrees/steps)*Math.PI/180;
            const v={...u,x:u.x-pad,y:u.y-pad,w:u.w+2*pad,h:u.h+2*pad,angle:u.angle+degrees*i/steps};
            if(!legalPosition(v,ctx.units,ctx.terrain,960,720,true)) throw Error('There is not enough clearance to pivot without touching an obstruction or the edge.');
        }
        return {...u,angle:u.angle+degrees};
    }
    function nearest(point,poly) {
        return Math.min(...poly.map((a,i)=>{const b=poly[(i+1)%poly.length],d=sub(b,a); const t=Math.max(0,Math.min(1,dot(sub(point,a),d)/dot(d,d)));return Math.hypot(point.x-a.x-t*d.x,point.y-a.y-t*d.y);}));
    }
    function shotReason(u,v,units,terrain) {
        if(!u.shoot) return 'This unit has no Shoot value.';
        if(!Number.isFinite(u.range)||u.range<=0) return 'This unit has no Range in its stats.';
        if(enemies(u,units).length || enemies(v,units).length) return 'Shooter and target must both be out of enemy contact.';
        const p=polygon(u), target=polygon(v), origin={x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2};
        const a=u.angle*Math.PI/180, forward={x:Math.sin(a),y:-Math.cos(a)};
        if(target.some(q=>dot(sub(q,origin),forward)<-EPS)) return 'The whole target must be in front of the shooter.';
        if(nearest(origin,target)>u.range*SCALE+EPS) return 'Target is out of range.';
        const high=inTerrain(u,terrain,['hills']);
        const blockers=[...(!high?units.filter(q=>q.id!==u.id&&q.id!==v.id):[]),...terrain.filter(t=>t.type==='forest'||t.type==='mountain'||(t.type==='hills'&&!touches(u,t)&&!touches(v,t)))];
        // Union of triangles covers every line from the front-centre to the target.
        if(blockers.some(b=>target.some((q,i)=>overlap([origin,q,target[(i+1)%target.length]],polygon(b))))) return 'The whole target is not visible: a unit or terrain blocks line of sight.';
        return '';
    }
    function outflanked(u,units) {
        const p=polygon(u);
        return enemies(u,units).some(v=>enemies(v,units).length===1 && [1,2,3].some(i=>{
            const a=p[i], b=p[(i+1)%4];
            // Side front corners alone belong to the front, so trim those endpoints.
            const aa=i===1?{x:a.x+(b.x-a.x)*1e-6,y:a.y+(b.y-a.y)*1e-6}:a;
            const bb=i===3?{x:b.x+(a.x-b.x)*1e-6,y:b.y+(a.y-b.y)*1e-6}:b;
            return overlap([aa,bb],polygon(v),true);
        }));
    }
    function attack(u,v,kind,ctx,random=Math.random) {
        if(u.owner===v.owner) throw Error('Choose an enemy target.');
        const shooting=kind==='Shoot';
        const reason=shooting?shotReason(u,v,ctx.units,ctx.terrain):(!touches(u,v)?'Strike requires contact with the target.':'');
        if(reason) throw Error(reason);
        const high=ctx.chargeHeight===undefined?inTerrain(u,ctx.terrain,['hills']):ctx.chargeHeight;
        const height=Number(high)-Number(inTerrain(v,ctx.terrain,['hills']));
        const flank=Number(outflanked(v,ctx.units))-Number(outflanked(u,ctx.units));
        const pool=Math.max(1,(shooting?u.shoot:u.melee)+height+flank);
        const target=shooting&&v.mobility>=3?6:Math.min(v.defence,(shooting?u.shootAP:u.meleeAP)?3:6);
        const die=()=>1+Math.floor(random()*6), rolls=Array.from({length:pool},die);
        const critical=rolls.filter(n=>n===6).map(die);
        return {pool,target,rolls,critical,height,flank,strain:[...rolls,...critical].filter(n=>n>=target).length};
    }
    return {polygon,overlap,touches,enemies,inTerrain,legalPosition,sweep,move,pivot,shotReason,outflanked,attack};
})();
if(typeof module!=='undefined') module.exports=BattleRules;
