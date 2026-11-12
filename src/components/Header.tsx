import { Search, Bell, Moon, Sun, Menu, Settings, LogIn, Home, CalendarDays, Star, Quote, ChevronDown, BookOpen, Library as LibraryIcon, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const zodiacSigns = [
  { name: "মেষ", symbol: "♈" }, { name: "বৃষ", symbol: "♉" }, { name: "মিথুন", symbol: "♊" },
  { name: "কর্কট", symbol: "♋" }, { name: "সিংহ", symbol: "♌" }, { name: "কন্যা", symbol: "♍" },
  { name: "তুলা", symbol: "♎" }, { name: "বৃশ্চিক", symbol: "♏" }, { name: "ধনু", symbol: "♐" },
  { name: "মকর", symbol: "♑" }, { name: "কুম্ভ", symbol: "♒" }, { name: "মীন", symbol: "♓" },
];

const Header = () => {
  const [isDark, setIsDark] = useState(false);
  const [selectedSign, setSelectedSign] = useState<string | null>(null);
  const [openCategoryId, setOpenCategoryId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const categoryCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isAdmin = location.pathname.startsWith("/admin");
  const activeCategory = searchParams.get("category");

  const dateParts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const datePart = (type: string) => dateParts.find((part) => part.type === type)?.value || "";
  const today = `${datePart("year")}-${datePart("month")}-${datePart("day")}`;
  const todayMonthDay = `${datePart("month")}-${datePart("day")}`;

  const { data: allCategories } = useQuery({
    queryKey: ["nav-categories-all"],
    queryFn: async () => {
      const { data } = await supabase.from("categories").select("*").order("sort_order");
      return (data || []) as any[];
    },
  });

  const { data: branding } = useQuery({
    queryKey: ["site-branding"],
    queryFn: async () => {
      const { data } = await supabase.from("site_settings").select("value").eq("key", "branding").maybeSingle();
      return (data?.value as any) || {};
    },
  });

  // Build parent-child hierarchy
  const parentCategories = allCategories?.filter((c: any) => !c.parent_id && c.show_in_nav) || [];
  const getChildren = (parentId: string) => allCategories?.filter((c: any) => c.parent_id === parentId && c.show_in_nav) || [];

  const { data: dailyContent } = useQuery({
    queryKey: ["daily-content", today],
    queryFn: async () => {
      const { data } = await supabase.from("daily_content").select("*").eq("date", today);
      return data || [];
    },
  });

  const onThisDay = dailyContent?.find((d: any) => d.content_type === "on_this_day")?.data as any;
  const horoscope = dailyContent?.find((d: any) => d.content_type === "horoscope")?.data as any;
  const quote = dailyContent?.find((d: any) => d.content_type === "quote")?.data as any;

  const { data: archivedToday = [] } = useQuery({
    queryKey: ["hist-events", todayMonthDay],
    queryFn: async () => {
      const { data } = await supabase.from("historical_events").select("year,event").eq("event_date", todayMonthDay).eq("category", "event").order("year", { ascending: true }).limit(20);
      return data || [];
    },
  });

  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = searchTerm.trim();
    navigate(query ? `/?q=${encodeURIComponent(query)}` : "/");
  };

  const openCategoryMenu = (categoryId: string) => {
    if (categoryCloseTimer.current) clearTimeout(categoryCloseTimer.current);
    setOpenCategoryId(categoryId);
  };

  const scheduleCategoryClose = () => {
    if (categoryCloseTimer.current) clearTimeout(categoryCloseTimer.current);
    categoryCloseTimer.current = setTimeout(() => setOpenCategoryId(null), 180);
  };

  const toggleDark = () => {
    setIsDark(!isDark);
    document.documentElement.classList.toggle("dark");
  };

  const selectedHoroscope = horoscope?.signs?.find((s: any) => s.name === selectedSign);

  return (
    <header className="sticky top-0 z-50 bg-card/95 backdrop-blur-sm border-b border-border" style={branding?.header_bg ? { backgroundImage: `linear-gradient(hsl(var(--card) / 0.9), hsl(var(--card) / 0.9)), url(${branding.header_bg})`, backgroundSize: "cover" } : undefined}>
      {/* Ticker */}
      <div className="ticker-bar flex items-center gap-3 overflow-hidden">
        <span className="bg-primary text-primary-foreground px-2 py-0.5 rounded text-xs font-bold shrink-0">
          ব্রেকিং
        </span>
        <div className="truncate text-xs">
          আজকের শীর্ষ সংবাদ • নতুন ব্লগ পোস্ট প্রকাশিত • ভ্রমণ গাইড আপডেট হয়েছে
        </div>
      </div>
      
      {/* Main Header */}
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="md:hidden">
            <Menu className="h-5 w-5" />
          </Button>
          <Link to="/" className="flex items-center gap-2 text-2xl md:text-3xl font-display font-black tracking-tight">
            {branding?.logo_url ? (
              <img src={branding.logo_url} alt="Logo" className="h-8 md:h-10 w-auto" />
            ) : (<>
              <span className="text-primary">AHAi</span>
              <span className="text-foreground">WEB</span>
            </>)}
          </Link>

        </div>

        <form onSubmit={submitSearch} className="hidden md:flex flex-1 max-w-md relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="AHAiWEB-এ খুঁজুন..." aria-label="সাইটে খুঁজুন" className="pl-9 h-9 bg-muted border-0" />
            <Button type="submit" variant="ghost" size="icon" aria-label="খুঁজুন" className="absolute right-0 top-0 h-9 w-9"><Search className="h-4 w-4" /></Button>
        </form>

        <div className="flex items-center gap-1">
          {isAdmin ? (
            <Button variant="ghost" size="sm" className="h-9 text-xs gap-1" asChild>
              <Link to="/"><Home className="h-4 w-4" /> মূলসাইট</Link>
            </Button>
          ) : user ? (
            <Button variant="ghost" size="sm" className="h-9 text-xs gap-1" asChild>
              <Link to="/admin"><Settings className="h-4 w-4" /> অ্যাডমিন</Link>
            </Button>
          ) : (
            <Button variant="ghost" size="sm" className="h-9 text-xs gap-1" asChild>
              <Link to="/login"><LogIn className="h-4 w-4" /> লগইন</Link>
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-9 w-9">
            <Bell className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={toggleDark}>
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <form onSubmit={submitSearch} className="md:hidden px-4 pb-2 relative">
        <Search className="absolute left-7 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="AHAiWEB-এ খুঁজুন..." aria-label="সাইটে খুঁজুন" className="pl-9 h-9 bg-muted border-0" />
        <Button type="submit" variant="ghost" size="icon" aria-label="খুঁজুন" className="absolute right-5 top-0 h-9 w-9"><Search className="h-4 w-4" /></Button>
      </form>

      {/* Category Nav */}
      {!isAdmin && (
        <nav className="max-w-7xl mx-auto px-4 pb-2 flex gap-1 overflow-x-auto text-sm scrollbar-hide">
          <Button 
            variant={!activeCategory ? "default" : "ghost"} 
            size="sm" 
            className="shrink-0 h-7 text-xs rounded-full"
            onClick={() => setSearchParams({})}
          >
            হোম
          </Button>
          {parentCategories.map((cat: any) => {
            const children = getChildren(cat.id);
            if (children.length > 0) {
              return (
                <Popover key={cat.id} open={openCategoryId === cat.id} onOpenChange={(open) => setOpenCategoryId(open ? cat.id : null)}>
                  <div className="relative shrink-0" onMouseEnter={() => openCategoryMenu(cat.id)} onMouseLeave={scheduleCategoryClose}>
                  <PopoverTrigger asChild>
                    <Button variant={activeCategory === cat.slug ? "default" : "ghost"} size="sm" className="h-7 text-xs rounded-full gap-1" aria-expanded={openCategoryId === cat.id}>
                      {cat.icon} {cat.name} {cat.external_url && <ExternalLink className="h-3 w-3" />} <ChevronDown className="h-3 w-3" />
                    </Button>
                  </PopoverTrigger>
                    <PopoverContent align="start" sideOffset={6} className="z-[100] w-[min(560px,90vw)] p-3" onMouseEnter={() => openCategoryMenu(cat.id)} onMouseLeave={scheduleCategoryClose}>
                      {cat.external_url ? (
                        <a className="mb-2 block w-full rounded px-2 py-1 text-left text-xs font-bold hover:bg-muted" href={cat.external_url} target="_blank" rel="noreferrer">সব {cat.name} → <ExternalLink className="inline h-3 w-3" /></a>
                      ) : (
                        <Button type="button" variant="ghost" size="sm" className="mb-2 h-8 w-full justify-start text-xs font-bold" onClick={() => { setSearchParams({ category: cat.slug }); setOpenCategoryId(null); }}>সব {cat.name} →</Button>
                      )}
                      <div className="grid max-h-[70vh] grid-cols-2 gap-1 overflow-y-auto sm:grid-cols-3">
                        {children.map((child: any) => child.external_url ? (
                          <a key={child.id} href={child.external_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted">
                            {child.icon && <span>{child.icon}</span>}<span className="truncate">{child.name}</span><ExternalLink className="ml-auto h-3 w-3" />
                          </a>
                        ) : (
                          <Button type="button" key={child.id} variant="ghost" size="sm" className="h-auto min-h-8 justify-start gap-2 px-2 py-1.5 text-left text-xs" onClick={() => { setSearchParams({ category: child.slug }); setOpenCategoryId(null); }}>
                            {child.icon && <span>{child.icon}</span>}<span className="truncate">{child.name}</span>
                          </Button>
                        ))}
                      </div>
                    </PopoverContent>
                  </div>
                </Popover>
              );
            }
            if (cat.external_url) {
              return (
                <Button key={cat.id} variant="ghost" size="sm" className="shrink-0 h-7 text-xs rounded-full gap-1" asChild>
                  <a href={cat.external_url} target="_blank" rel="noreferrer">{cat.icon} {cat.name} <ExternalLink className="h-3 w-3" /></a>
                </Button>
              );
            }
            return (
              <Button
                key={cat.id}
                variant={activeCategory === cat.slug ? "default" : "ghost"}
                size="sm"
                className="shrink-0 h-7 text-xs rounded-full"
                onClick={() => setSearchParams({ category: cat.slug })}
              >
                {cat.icon} {cat.name}
              </Button>
            );
          })}

          <Button variant="ghost" size="sm" className="shrink-0 h-7 text-xs rounded-full gap-1" asChild>
            <Link to="/dictionary"><BookOpen className="h-3 w-3" /> অভিধান</Link>
          </Button>
          <Button variant="ghost" size="sm" className="shrink-0 h-7 text-xs rounded-full gap-1" asChild>
            <Link to="/library"><LibraryIcon className="h-3 w-3" /> লাইব্রেরি</Link>
          </Button>


          {/* আজকের দিনে Dropdown */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="shrink-0 h-7 text-xs rounded-full gap-1">
                📅 আজকের দিনে <ChevronDown className="h-3 w-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="start">
              <Tabs defaultValue="today" className="w-full">
                <TabsList className="w-full grid grid-cols-3 h-9 rounded-none rounded-t-md">
                  <TabsTrigger value="today" className="text-xs gap-1"><CalendarDays className="h-3 w-3" /> এই দিনে</TabsTrigger>
                  <TabsTrigger value="horoscope" className="text-xs gap-1"><Star className="h-3 w-3" /> রাশি</TabsTrigger>
                  <TabsTrigger value="quotes" className="text-xs gap-1"><Quote className="h-3 w-3" /> উক্তি</TabsTrigger>
                </TabsList>

                <TabsContent value="today" className="p-3 mt-0 space-y-2.5 max-h-64 overflow-y-auto">
                  {archivedToday.length || onThisDay?.events?.length ? (
                    (archivedToday.length ? archivedToday : onThisDay.events).map((e: any, i: number) => (
                      <div key={i} className="border-l-2 border-accent pl-3">
                        <p className="text-xs font-bold text-muted-foreground">{e.year}</p>
                        <p className="text-sm">{e.event}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-muted-foreground text-center py-4">ডেটা লোড হচ্ছে...</p>
                  )}
                </TabsContent>

                <TabsContent value="horoscope" className="p-3 mt-0">
                  {selectedSign && selectedHoroscope ? (
                    <div>
                      <Button variant="ghost" size="sm" className="text-xs mb-2 h-6 px-2" onClick={() => setSelectedSign(null)}>← সব রাশি</Button>
                      <div className="text-center py-2">
                        <p className="text-3xl">{selectedHoroscope.symbol}</p>
                        <p className="font-medium text-sm mt-1">{selectedHoroscope.name}</p>
                        <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{selectedHoroscope.prediction}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-4 gap-1.5">
                      {zodiacSigns.map((sign) => (
                        <button
                          key={sign.name}
                          onClick={() => setSelectedSign(sign.name)}
                          className="flex flex-col items-center p-2 rounded-lg hover:bg-muted transition-colors"
                        >
                          <span className="text-lg">{sign.symbol}</span>
                          <span className="text-[10px] mt-0.5">{sign.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {!horoscope?.signs && (
                    <p className="text-xs text-muted-foreground text-center py-4">ডেটা লোড হচ্ছে...</p>
                  )}
                </TabsContent>

                <TabsContent value="quotes" className="p-3 mt-0">
                  {quote?.text ? (
                    <>
                      <blockquote className="border-l-2 border-primary pl-3 italic text-sm text-muted-foreground">"{quote.text}"</blockquote>
                      <p className="text-xs text-right mt-2 text-muted-foreground">— {quote.author}</p>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground text-center py-4">ডেটা লোড হচ্ছে...</p>
                  )}
                </TabsContent>
              </Tabs>
            </PopoverContent>
          </Popover>
        </nav>
      )}
    </header>
  );
};

export default Header;
