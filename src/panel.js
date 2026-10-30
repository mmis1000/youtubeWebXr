import { colors as C, fontStack } from './theme.js';

export const PANEL_HEIGHT = 312;
export const qualityPageSize = count => count > 6 ? 4 : 6;
const font = (weight, size) => `${weight} ${size}px ${fontStack}`;
const timeLabel = time => { const n = Math.max(0, Math.floor(time || 0)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; };
function rounded(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r); }
function icon(c, name, x, y, size, color, angle = 0) {
  c.save(); c.translate(x, y); c.fillStyle = color; c.strokeStyle = color;
  c.lineWidth = Math.max(2.5, size * .09); c.lineCap = 'round'; c.lineJoin = 'round';
  if (name === 'play') { c.beginPath(); c.moveTo(-size*.26,-size*.36); c.lineTo(size*.4,0); c.lineTo(-size*.26,size*.36); c.closePath(); c.fill(); }
  if (name === 'pause') { rounded(c,-size*.3,-size*.34,size*.2,size*.68,3); c.fill(); rounded(c,size*.1,-size*.34,size*.2,size*.68,3); c.fill(); }
  if (name === 'back' || name === 'forward') {
    const direction = name === 'back' ? -1 : 1;
    c.beginPath(); c.arc(0,0,size*.44,-Math.PI*.5,direction<0?Math.PI*1.1:-Math.PI*1.1,direction>0); c.stroke();
    c.beginPath(); c.moveTo(0,-size*.44); c.lineTo(-direction*size*.17,-size*.58);
    c.moveTo(0,-size*.44); c.lineTo(-direction*size*.17,-size*.27); c.stroke();
    c.font = font(600,22); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('10',0,2);
  }
  if (name === 'recenter') {
    c.beginPath(); c.arc(0,0,size*.28,0,Math.PI*2); c.stroke(); c.beginPath(); c.arc(0,0,size*.08,0,Math.PI*2); c.fill();
    for (const [a,b] of [[0,-1],[0,1],[-1,0],[1,0]]) { c.beginPath(); c.moveTo(a*size*.28,b*size*.28); c.lineTo(a*size*.46,b*size*.46); c.stroke(); }
  }
  if (name === 'hide') {
    c.beginPath(); c.ellipse(0,0,size*.4,size*.24,0,0,Math.PI*2); c.stroke(); c.beginPath(); c.arc(0,0,size*.1,0,Math.PI*2); c.fill();
    c.beginPath(); c.moveTo(-size*.38,-size*.34); c.lineTo(size*.38,size*.34); c.stroke();
  }
  if (name === 'warn') {
    c.beginPath(); c.moveTo(0,-size*.4); c.lineTo(size*.42,size*.34); c.lineTo(-size*.42,size*.34); c.closePath(); c.stroke();
    c.beginPath(); c.moveTo(0,-size*.12); c.lineTo(0,size*.1); c.stroke(); c.beginPath(); c.arc(0,size*.23,size*.035,0,Math.PI*2); c.fill();
  }
  if (name === 'spin') { c.rotate(angle); c.beginPath(); c.arc(0,0,size*.34,-Math.PI/2,Math.PI*.9); c.stroke(); }
  c.restore();
}

export function paintPanel(c, s, { hovered = [], pressed = [], dragRatio, hoverRatio, menu = false, menuPage = 0, now = 0 } = {}) {
  const buttons = [], blocked = s.busy || !!s.error || !Number.isFinite(s.duration) || s.duration <= 0;
  const fit = (value, width) => {
    let text = String(value); if (c.measureText(text).width <= width) return text;
    while (text && c.measureText(text + '…').width > width) text = text.slice(0, -1);
    return text + '…';
  };
  const button = (id, label, x, y, w, h, { glyph, primary = false, disabled = false, fill, color, selected = false, pending = false, bare = false } = {}) => {
    buttons.push({ id, label, x, y, w, h, disabled });
    const over = !disabled && hovered.includes(id), down = !disabled && pressed.includes(id);
    const background = disabled ? C.raised : down ? C.hover : primary || selected ? over ? '#ffffff' : C.text : over ? C.hover : fill || C.raised;
    const foreground = disabled ? C.dim : down ? C.text : primary || selected ? C.surface : color || C.text;
    if (!bare || over || down) { rounded(c,x,y,w,h,h/2); c.fillStyle=background; c.fill(); }
    if (over || down) { rounded(c,x-5,y-5,w+10,h+10,h/2+5); c.strokeStyle=down?C.text:C.ring; c.lineWidth=3; c.stroke(); }
    c.font=font(600,24); c.textAlign='center'; c.textBaseline='middle';
    if (label && (glyph || pending)) {
      const total = c.measureText(label).width + 32;
      icon(c,pending?'spin':glyph,x+w/2-total/2+12,y+h/2,24,foreground,now/240);
      c.fillStyle=foreground; c.fillText(label,x+w/2+16,y+h/2);
    } else if (glyph || pending) icon(c,pending?'spin':glyph,x+w/2,y+h/2,primary?46:40,foreground,now/240);
    else { c.fillStyle=foreground; c.fillText(label,x+w/2,y+h/2); }
    c.textBaseline='alphabetic';
  };
  c.clearRect(0,0,1024,512);
  rounded(c,1,1,1022,PANEL_HEIGHT-2,36); c.fillStyle=C.surface; c.fill(); c.strokeStyle=C.line; c.lineWidth=2; c.stroke();
  c.textAlign='left'; c.fillStyle=C.text; c.font=font(600,30);
  c.fillText(fit(s.title || 'YouTube VR180',menu?720:800),48,62);
  c.font=font(400,s.error?24:23); c.fillStyle=s.error?C.warn:C.sub;
  if (s.error || s.busy) {
    icon(c,s.error?'warn':'spin',60,92,26,s.error?C.warn:C.sub,now/240);
    c.fillText(fit(s.error || s.status || `Loading ${s.requestedQuality}p…`,790),84,100);
  } else c.fillText(`${s.quality ? s.quality + 'p · ' : ''}${s.layout || 'Stereo 180°'}`,48,100);
  button('hide-ui','',900,30,76,76,{glyph:'hide',bare:true,color:C.sub});
  if (menu) button('exit','Exit',788,32,100,72);

  const elapsed = dragRatio == null ? s.time : dragRatio * s.duration;
  const fraction = Math.max(0,Math.min(1,(elapsed || 0)/(s.duration || 1))), playhead = 128+768*fraction;
  buttons.push({id:'seek',label:'Seek',x:128,y:114,w:768,h:72,disabled:blocked});
  c.font=font(500,22); c.fillStyle=C.sub; c.textAlign='right'; c.fillText(timeLabel(elapsed),108,158);
  c.textAlign='left'; c.fillText(timeLabel(s.duration),916,158);
  rounded(c,128,146,768,8,4); c.fillStyle=C.track; c.fill();
  if (fraction > 0) { rounded(c,128,146,Math.max(8,768*fraction),8,4); c.fillStyle=blocked?C.dim:C.accent; c.fill(); }
  const seekHover = !blocked && (hovered.includes('seek') || dragRatio != null);
  c.beginPath(); c.arc(playhead,150,seekHover?14:10,0,Math.PI*2); c.fillStyle=blocked?C.dim:C.text; c.fill();
  if (seekHover) {
    const ratio = dragRatio ?? hoverRatio ?? fraction;
    c.font=font(600,22); c.fillStyle=C.text; c.textAlign='center'; c.fillText(timeLabel(ratio*s.duration),128+768*ratio,128);
  }
  const quality = s.busy || s.error ? s.requestedQuality : s.quality;
  if (menu) {
    const qualities=s.qualities || [], paged=qualities.length>6, size=qualityPageSize(qualities.length);
    button('quality-back','‹ Back',48,204,112,72);
    if (paged) button('quality-previous','‹',176,204,72,72,{disabled:menuPage===0});
    const start=paged?264:184, width=paged?132:(792-Math.max(0,qualities.length-1)*12)/Math.max(1,qualities.length), gap=paged?16:12;
    for (const [i,height] of qualities.slice(menuPage*size,(menuPage+1)*size).entries()) {
      button(`quality:${height}`,`${height}p`,start+i*(width+gap),204,width,72,
        {selected:height===s.quality&&!s.busy,pending:s.busy&&!s.quality&&height===s.requestedQuality});
    }
    if (paged) button('quality-next','Next ›',856,204,120,72,{disabled:(menuPage+1)*size>=qualities.length});
  } else {
    button('recenter','Recenter',48,204,200,72,{glyph:'recenter'});
    button('back','',366,202,76,76,{glyph:'back',disabled:blocked});
    if (s.error) button('retry','Retry',452,204,120,72,{fill:C.warn,color:C.surface});
    else button('toggle','',466,194,92,92,{glyph:s.busy?'spin':s.paused?'play':'pause',primary:true,disabled:blocked});
    button('forward','',582,202,76,76,{glyph:'forward',disabled:blocked});
    button('quality',`${quality ? quality + 'p' : '…'} ▾`,700,204,150,72,{disabled:!s.qualities?.length});
    button('exit','Exit',866,204,110,72);
  }
  return buttons;
}
