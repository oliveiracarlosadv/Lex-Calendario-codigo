/**
 * Contagem de prazos processuais (CPC/2015).
 *  - art. 219: computam-se somente os dias úteis;
 *  - art. 224: exclui-se o dia do começo e inclui-se o do vencimento;
 *    prorroga-se para o primeiro dia útil se o vencimento cair em dia sem expediente;
 *  - art. 220: suspensão do curso dos prazos entre 20 de dezembro e 20 de janeiro.
 * Feriados locais/forenses podem ser informados via `extraHolidays` (AAAA-MM-DD).
 */

export interface DeadlineOptions {
  businessDays?: boolean;
  extraHolidays?: string[];
  applyForensicRecess?: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const toISODate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

const addDays = (d: Date, n: number) => {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() + n);
  return r;
};

/**
 * Feriados nacionais e dias sem expediente forense em âmbito nacional.
 * Feriados próprios de cada ramo (ex.: 1º/11 e 8/12 na Justiça Federal — Lei 5.010/66, art. 62),
 * estaduais e municipais devem ser informados em `extraHolidays`.
 */
export function federalJusticeHolidays(year: number): string[] {
  return [`${year}-11-01`, `${year}-12-08`];
}

export function nationalHolidays(year: number): Set<string> {
  const easter = easterSunday(year);
  const fixed = [
    `${year}-01-01`, // Confraternização Universal
    `${year}-04-21`, // Tiradentes
    `${year}-05-01`, // Dia do Trabalho
    `${year}-09-07`, // Independência
    `${year}-10-12`, // N. Sra. Aparecida
    `${year}-11-02`, // Finados
    `${year}-11-15`, // Proclamação da República
    `${year}-11-20`, // Dia Nacional de Zumbi e da Consciência Negra (Lei 14.759/2023)
    `${year}-12-25`, // Natal
  ];
  const movable = [
    addDays(easter, -48), // Carnaval (segunda)
    addDays(easter, -47), // Carnaval (terça)
    addDays(easter, -46), // Quarta-feira de Cinzas (expediente reduzido; tratado como não útil)
    addDays(easter, -3), // Quinta-feira Santa
    addDays(easter, -2), // Sexta-feira da Paixão
    addDays(easter, 60), // Corpus Christi
  ].map(toISODate);
  return new Set([...fixed, ...movable]);
}

export function isInForensicRecess(d: Date): boolean {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return (m === 12 && day >= 20) || (m === 1 && day <= 20);
}

export function isBusinessDay(d: Date, opts: DeadlineOptions = {}): boolean {
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return false;
  const iso = toISODate(d);
  if (nationalHolidays(d.getFullYear()).has(iso)) return false;
  if (opts.extraHolidays?.includes(iso)) return false;
  if ((opts.applyForensicRecess ?? true) && isInForensicRecess(d)) return false;
  return true;
}

/**
 * Calcula o termo final de um prazo.
 * @param startDate data da intimação/publicação (dia do começo, excluído)
 * @param days quantidade de dias do prazo
 */
export function computeDeadline(startDate: Date, days: number, opts: DeadlineOptions = {}): Date {
  if (days <= 0) throw new RangeError("O prazo deve ser positivo.");
  const businessDays = opts.businessDays ?? true;
  let cursor = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());

  if (businessDays) {
    let counted = 0;
    while (counted < days) {
      cursor = addDays(cursor, 1);
      if (isBusinessDay(cursor, opts)) counted++;
    }
    return cursor;
  }

  // Dias corridos (ex.: prazos materiais ou de direito penal): prorroga o vencimento
  cursor = addDays(cursor, days);
  while (!isBusinessDay(cursor, opts)) cursor = addDays(cursor, 1);
  return cursor;
}
