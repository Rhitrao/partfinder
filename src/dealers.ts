// Manufacturers' own dealer locators, as data. One row per manufacturer and country.
//
// The rule for this file, from the step 4 prompt and from CLAUDE.md's "no claim without a link":
// a row may be added only after its URL has actually been loaded and confirmed to be that
// manufacturer's own dealer-locator page. A URL is never guessed, and never taken from a search
// result without opening it. "Authorised <OEM> dealers" is a claim about who is authorised, and
// a dead or wrong link under that label is worse than no link at all.
//
// The table is empty today. Every manufacturer domain needed for it is refused by the egress
// policy of the session this was written in, so not one URL could be opened:
//
//   www.caterpillar.com   www.cat.com          www.jcb.com        www.jcbindia.com
//   www.komatsu.com       www.komatsuindia.in  www.hitachicm.com  www.kobelco-cmi.com
//   www.volvoce.com       www.tatahitachi.co.in
//
// Each answered the proxy's CONNECT with 403. The links render the moment a row is added, so
// filling this in is a data commit and needs no code change.

export interface DealerLocator {
  /** Exactly as the manufacturer is named in src/rules.ts. */
  oem: string;
  /** A country code from COUNTRIES in src/page.ts. */
  country: string;
  /** The manufacturer's own dealer-locator page, opened and confirmed. */
  url: string;
  /** ISO date (YYYY-MM-DD) the URL was last opened and confirmed. */
  verifiedOn: string;
  /** One line on what the page turned out to be, for whoever checks it next. */
  note: string;
}

export const DEALER_LOCATORS: readonly DealerLocator[] = [];

/** The locator for one manufacturer in one country, or undefined when none has been confirmed. */
export function findDealerLocator(
  oem: string,
  country: string,
  table: readonly DealerLocator[] = DEALER_LOCATORS,
): DealerLocator | undefined {
  return table.find((d) => d.oem === oem && d.country === country);
}
