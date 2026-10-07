const amountFormat = new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** KES amounts throughout the app share this format, so a figure reads the same on every page. */
export function money(value: string | number): string {
  return `KES ${amountFormat.format(Number(value))}`
}
