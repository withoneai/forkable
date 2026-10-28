import { useState } from "react";
import { Frame } from "../../gallery/src/Frame";
import { GmailCompose } from "./GmailCompose";
import { Button } from "../lib/one-ui";

export default function Preview() {
  const [open, setOpen] = useState(true);
  return (
    <Frame center>
      {open ? (
        <GmailCompose open onClose={() => setOpen(false)} initial={{ to: ["priya@northwind.vc"], subject: "Pro rata", body: "Priya,\n\nWe are fine with the board seat at close. On pro rata, can we cap it at the Series B?\n\nDana" }} />
      ) : (
        <Button variant="primary" onClick={() => setOpen(true)}>
          Compose
        </Button>
      )}
    </Frame>
  );
}
