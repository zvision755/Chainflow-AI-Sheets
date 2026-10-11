// Shared overview widths: two columns plus a hint on phones, more columns on wide screens.
export function overviewColumnWidth(availableWidth:number,numberWidth:number){return availableWidth?Math.min(220,Math.max(1,Math.floor((availableWidth-numberWidth)/2.05))):160;}
export const DESKTOP_ROW_HEIGHT=168;

export const DESKTOP_COLUMN_WIDTH=440;
