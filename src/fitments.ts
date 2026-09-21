// Which machines a part is commonly fitted to, as data.
//
// This is the first thing Partfinder says about a part that is not read off the number itself,
// so the rules around it are tighter than anywhere else in the repo.
//
// One entry per canonical part, and an entry exists only where a public page has actually been
// opened and read. A part with no entry renders nothing: there is no inference from a
// neighbouring number, no carrying an entry across to a suffixed variant, and no filling a gap
// with what a model happens to know. Adding an entry is a data commit, like src/dealers.ts and
// src/taxonomy - the list renders by itself once the data is there.
//
// Every entry carries its own tier, its source URL and the date the source was read, and the
// page prints all three under the list. A fitment list is a claim about somebody's machine, and
// CLAUDE.md's third hard line is that there is no claim without a link.

/** One heading in a fitment list, and the machines under it. */
export interface MachineGroup {
  heading: string;
  machines: readonly string[];
}

export interface Fitment {
  /** The canonical part, exactly as partKey() builds it: canonical form plus any suffix. */
  part: string;
  /** Grouped by machine family, because fifty model numbers in one run is not a list. */
  machines: readonly MachineGroup[];
  /**
   * The source tier from CLAUDE.md's table, and it follows from `sources` rather than being
   * chosen: one seller's listing is T4, and two or more independent domains agreeing is T3. The
   * tier is stored rather than computed because counting URLs is not the same as reading them -
   * five domains reposting one listing count once, and only a person can see that.
   */
  basis: string;
  /**
   * Every page this list was read off, each one printed on the page as a link.
   *
   * An array rather than a single URL because that is what the tier turns on. A second
   * independent domain agreeing raises this entry from T4 to T3, and that should be one line of
   * data and a changed tier, not a change to the shape of the file.
   */
  sources: readonly string[];
  /** ISO date the source page was read. Printed as is: a fitment list goes stale. */
  checkedOn: string;
  /** What the list is and is not. Printed under it, every time, in muted text. */
  note: string;
}

export const FITMENTS: readonly Fitment[] = [
  {
    part: "1U-3352",
    // One seller's listing. CLAUDE.md: T4 is "One seller or one tender claims it"; T3 needs two
    // or more independent domains to agree, and there is one domain here.
    basis: "T4",
    sources: ["https://www.romacparts.com/1u3352-teeth.html"],
    checkedOn: "2026-09-18",
    note:
      "Compiled from aftermarket seller listings, not Caterpillar's own catalogue. " +
      "Lists vary between sellers.",
    machines: [
      {
        heading: "Excavators",
        machines: [
          "213B", "214B", "215B", "224B", "225", "229", "245",
          "318B", "318C", "320", "320B", "320C", "320D", "320D2", "320E",
          "321D LCR", "322", "322B", "322C", "323D L", "324D",
          "325", "325B", "325C", "330", "330B L",
          "E200B", "E240", "E240C", "EL240B",
        ],
      },
      {
        heading: "Wheel loaders",
        machines: [
          "950B", "950F", "950G", "960F", "962G",
          "966D", "966F", "966G", "966H", "966K",
          "970F", "972G", "972H", "980C", "980F",
        ],
      },
      {
        heading: "Track loaders and other",
        machines: ["963B", "963C", "973", "973C", "227", "633E", "M322C"],
      },
    ],
  },
];

/** The entry for a part key, or undefined. An exact match only: a near miss is a guess. */
export function findFitment(part: string): Fitment | undefined {
  return FITMENTS.find((entry) => entry.part === part);
}

/** The host a source is on, without "www.", which is what the page prints as the link's label.
 * Whether two sources are independent domains is the whole of the T4/T3 question, so the page
 * shows the domains rather than the word "Source" twice. */
export function sourceLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** How many machines the entry names, across every group. The summary says this number. */
export function machineCount(fitment: Fitment): number {
  return fitment.machines.reduce((total, group) => total + group.machines.length, 0);
}
