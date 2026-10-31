import { Badge } from "@/components/ui/badge";
import { STAGE_COLOR, STAGE_LABEL, type Stage } from "@/lib/crm";
import { cn } from "@/lib/utils";

export function StageBadge({ stage, className }: { stage: Stage; className?: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium", STAGE_COLOR[stage], className)}>
      {STAGE_LABEL[stage]}
    </Badge>
  );
}
