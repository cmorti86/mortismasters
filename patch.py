
import sys

with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

old = """      if(phase==='post'&&e.alt){
        const mcIdx=activePicks.findIndex(p=>{const d=gLive(p);return d&&d.isMC;});
        if(mcIdx!==-1){activePicks=[...activePicks];activePicks[mcIdx]=e.alt;altUsed=true;}
      }"""

new = """      if(phase==='post'&&e.alt){
        const hasLD=Object.keys(liveData).length>0;
        const mcIdx=activePicks.findIndex(p=>{
          if(!p)return false;
          const d=gLive(p);
          if(d&&isOutOfTournament(d))return true;
          if(hasLD&&!d)return true;
          return false;
        });
        if(mcIdx!==-1){activePicks=[...activePicks];activePicks[mcIdx]=e.alt;altUsed=true;}
      }"""

old2 = """  if(ph==='post'&&e.alt){
    const mi=ps.findIndex(p=>{const d=gLive(p);return isOutOfTournament(d)||(isTournamentLive()&&!d);});
    if(mi!==-1){ps=[...ps];ps[mi]=e.alt;}
  }"""

new2 = """  if(ph==='post'&&e.alt){
    const hasLD=Object.keys(liveData).length>0;
    const mi=ps.findIndex(p=>{
      if(!p)return false;
      const d=gLive(p);
      if(d&&isOutOfTournament(d))return true;
      if(hasLD&&!d)return true;
      return false;
    });
    if(mi!==-1){ps=[...ps];ps[mi]=e.alt;}
  }"""

c1 = content.replace(old, new)
c2 = c1.replace(old2, new2)

changed = c2 != content
with open('index.html', 'w', encoding='utf-8') as f:
    f.write(c2)

print("Changed:", changed)
print("Size:", len(c2))
