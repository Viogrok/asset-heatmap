import {layoutTree,type LayoutItem,type HeatmapNode} from 'openalgo-heatmap/core';

export type AreaMode='equal'|'move'|'size';
export type TileInput={id:string;group:string;value:number|null;change:number|null;scale?:number|null};

// Indices, funds and coins do not share a comparable market-cap unit.
// The watch view can compare equal tiles or absolute percentage movement.
export function layoutHeatmap(rows:TileInput[],width:number,height:number,portfolio:boolean,areaMode:AreaMode){
 const included=rows.filter(r=>portfolio?r.value!=null&&Number.isFinite(r.value)&&r.value>0:areaMode==='size'?r.scale!=null&&Number.isFinite(r.scale)&&r.scale>0:areaMode==='equal'||r.change!=null&&Number.isFinite(r.change));
 const groups=new Map<string,TileInput[]>();
 for(const row of included)groups.set(row.group,[...(groups.get(row.group)||[]),row]);
 const nodes:HeatmapNode[]=[...groups.entries()].sort(([a],[b])=>a.localeCompare(b,'zh-CN')).map(([name,list])=>({name,children:[...list].sort((a,b)=>{
  const delta=portfolio?(b.value||0)-(a.value||0):areaMode==='size'?(b.scale||0)-(a.scale||0):Math.abs(b.change||0)-Math.abs(a.change||0);
  return delta||a.id.localeCompare(b.id);
 }).map(r=>({symbol:r.id,value:portfolio?r.value!:areaMode==='size'?r.scale!:areaMode==='equal'?1:Math.abs(r.change!),change:r.change||0}))}));
 const out:LayoutItem[]=[];
 layoutTree(nodes,{x:0,y:0,w:width,h:height},0,{headerHeight:26,pad:3},out);
 return out;
}

type RGB=readonly [number,number,number];
function luminance(rgb:RGB){const linear=rgb.map(c=>{const s=c/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4;});return linear[0]*.2126+linear[1]*.7152+linear[2]*.0722;}
export function contrastRatio(a:RGB,b:RGB){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}

// A saturated low-movement floor keeps a small gain visibly different from zero.
// Foreground is selected from the actual background, including bright greens.
export function tileStyle(change:number|null|undefined,redUp:boolean){
 let rgb:RGB;
 if(change==null||!Number.isFinite(change))rgb=[45,58,77];
 else if(change===0)rgb=[86,101,122];
 else{
  const red=(change>0)===redUp;
  const low:RGB=red?[192,20,53]:[0,132,80];
  const high:RGB=red?[255,68,94]:[16,224,133];
  const t=Math.min(1,Math.abs(change)/3)**.65;
  rgb=low.map((c,i)=>Math.round(c+(high[i]-c)*t)) as unknown as RGB;
 }
 const light:RGB=[255,255,255],dark:RGB=[0,0,0];
 const ink=contrastRatio(rgb,light)>=contrastRatio(rgb,dark)?light:dark;
 return {fill:`rgb(${rgb.join(',')})`,ink:`rgb(${ink.join(',')})`,contrast:contrastRatio(rgb,ink),missing:change==null||!Number.isFinite(change)};
}

