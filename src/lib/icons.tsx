import {
  Anchor, Axe, BookOpen, Bot, Bug, Building2, CalendarDays, Car, Castle, Cat, Church, Cpu, Crown,
  Crosshair, Dices, Dna, Drama, Factory, FileText, Flag, FlaskConical, Flame, Gem, Ghost, Globe, Hammer,
  Heart, Landmark, Languages, Leaf, Map, MapPin, Moon, Mountain, Music, Orbit, Package, PawPrint, Plane,
  Radiation, Rocket, Satellite, ScrollText, Shield, Ship, Skull, Sparkles, StickyNote, Sun, Swords,
  Tent, TreePine, User, Users, Wand2, Waves, Wrench, Zap,
  type LucideIcon, type LucideProps,
} from "lucide-react";

/** Icons a user can pick for an entry type. Stored by name in the world file. */
export const TYPE_ICONS: Record<string, LucideIcon> = {
  User, Users, Crown, Drama, Ghost, Bot, Cat, PawPrint, Bug, Dna, Heart,
  MapPin, Map, Globe, Castle, Landmark, Church, Building2, Factory, Tent, Mountain, TreePine, Waves, Leaf,
  Rocket, Orbit, Satellite, Moon, Sun, Plane, Ship, Anchor, Car,
  Shield, Swords, Axe, Crosshair, Skull, Radiation, Flame, Zap,
  Sparkles, Wand2, Gem, FlaskConical, Cpu, Wrench, Hammer, Package,
  ScrollText, BookOpen, Languages, Music, Flag, CalendarDays, Dices, StickyNote, FileText,
};

export function TypeIcon({ name, ...props }: { name: string } & LucideProps) {
  const Icon = TYPE_ICONS[name] ?? FileText;
  return <Icon {...props} />;
}
