import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

function current(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** Light or dark. Follows the system until the user picks one. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(current);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);
  const set = (t: Theme) => {
    try {
      localStorage.setItem("theme", t);
    } catch {
      /* private mode */
    }
    setTheme(t);
  };
  return [theme, set];
}
