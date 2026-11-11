import { ImageOff } from "lucide-react";
import { BrailleLoader } from "@/components/braille-loader";
import { useLinearImage } from "./linear-queries";

/** Images of a description or comment: Linear uploads go through the backend (they need the key). */
export function LinearImage({ orgId, src, alt }: { orgId: string | undefined; src: string; alt: string }) {
  const image = useLinearImage(orgId, src);
  const local = src.startsWith("data:");
  if (!local && !image.data) {
    return (
      <span className="my-2 flex h-24 w-full max-w-md items-center justify-center rounded-lg border border-dashed border-white/10 text-[12px] text-muted-foreground">
        {image.isPending && image.fetchStatus !== "idle" ? (
          <BrailleLoader />
        ) : (
          <ImageOff aria-hidden className="size-4" />
        )}
      </span>
    );
  }
  return (
    <img
      src={local ? src : image.data}
      alt={alt}
      className="my-2 max-h-[480px] rounded-lg border border-white/[0.06]"
    />
  );
}
