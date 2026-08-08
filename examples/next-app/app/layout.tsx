import type { ReactNode } from "react"
import "@rulekit/ui/styles.css"
import "./app.css"

export const metadata = {
  title: "rulekit",
  description: "A grounded rules assistant over a local corpus.",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
