/** Intl currency formatting only accepts ISO-style three-letter codes. Token quotes retain their own unit. */
export function formatMoney(value:number,currency:string,maximumFractionDigits=2){
 if(!Number.isFinite(value))return '—';
 if(/^[A-Z]{3}$/.test(currency))return new Intl.NumberFormat('zh-CN',{style:'currency',currency,maximumFractionDigits}).format(value);
 return new Intl.NumberFormat('zh-CN',{maximumFractionDigits,minimumFractionDigits:Math.min(2,maximumFractionDigits)}).format(value)+' '+currency;
}
