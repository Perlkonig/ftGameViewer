/** Format a preset counter id as `BBB-VV` (3-digit base, 2-digit variant). */
export function counterLabel(base: number, variant: number): string {
    return `${String(base).padStart(3, "0")}-${String(variant).padStart(2, "0")}`;
}
