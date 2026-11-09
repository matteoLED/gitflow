import {
  BarChart3,
  Book,
  Box,
  Briefcase,
  Bug,
  Calendar,
  Cloud,
  Code,
  CreditCard,
  Database,
  Flag,
  Gift,
  Globe,
  Heart,
  House,
  Image,
  Key,
  Lightbulb,
  Link,
  Lock,
  Mail,
  Map,
  Megaphone,
  MessageCircle,
  Package,
  Puzzle,
  Rocket,
  Search,
  Server,
  Settings,
  Shield,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Star,
  Target,
  Trophy,
  Truck,
  Users,
  Video,
  Wallet,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Linear's icon names (its own set) mapped to the closest Lucide icon; anything else gets a box.
const ICONS: Record<string, LucideIcon> = {
  rocket: Rocket,
  bug: Bug,
  book: Book,
  briefcase: Briefcase,
  calendar: Calendar,
  chart: BarChart3,
  cloud: Cloud,
  code: Code,
  creditcard: CreditCard,
  cube: Box,
  database: Database,
  flag: Flag,
  gift: Gift,
  globe: Globe,
  heart: Heart,
  home: House,
  image: Image,
  key: Key,
  lightbulb: Lightbulb,
  link: Link,
  lock: Lock,
  mail: Mail,
  map: Map,
  megaphone: Megaphone,
  chat: MessageCircle,
  package: Package,
  puzzle: Puzzle,
  search: Search,
  server: Server,
  settings: Settings,
  gear: Settings,
  shield: Shield,
  cart: ShoppingCart,
  phone: Smartphone,
  mobile: Smartphone,
  sparkles: Sparkles,
  star: Star,
  target: Target,
  trophy: Trophy,
  truck: Truck,
  users: Users,
  team: Users,
  video: Video,
  wallet: Wallet,
  tool: Wrench,
  wrench: Wrench,
  bolt: Zap,
  lightning: Zap,
};

const isEmoji = (icon: string) => /\p{Extended_Pictographic}/u.test(icon);

/** A project's icon in its color: its emoji, or its Linear icon drawn with Lucide. */
export function ProjectIcon({
  project,
  className,
}: {
  project: { icon: string | null; color: string };
  className?: string;
}) {
  const icon = project.icon ?? "";
  if (isEmoji(icon))
    return (
      <span className={cn("inline-grid size-3.5 place-items-center text-[12px] leading-none", className)}>{icon}</span>
    );
  const Icon = ICONS[icon.toLowerCase().replace(/[^a-z]/g, "")] ?? Box;
  return <Icon aria-hidden className={cn("size-3.5 shrink-0", className)} style={{ color: project.color }} />;
}
