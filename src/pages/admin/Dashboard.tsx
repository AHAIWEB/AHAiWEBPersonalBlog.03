import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Image, Eye, Heart, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

const AdminDashboard = () => {
  const { data: postCount } = useQuery({
    queryKey: ["admin-post-count"],
    queryFn: async () => {
      const { count } = await supabase.from("posts").select("*", { count: "exact", head: true });
      return count || 0;
    },
  });

  const { data: mediaCount } = useQuery({
    queryKey: ["admin-media-count"],
    queryFn: async () => {
      const { count } = await supabase.from("media").select("*", { count: "exact", head: true });
      return count || 0;
    },
  });

  const { data: recentPosts } = useQuery({
    queryKey: ["admin-recent-posts"],
    queryFn: async () => {
      const { data } = await supabase
        .from("posts")
        .select("id, title, status, created_at, views, likes")
        .order("created_at", { ascending: false })
        .limit(5);
      return data || [];
    },
  });

  const { data: teamMembers = [] } = useQuery({
    queryKey: ["admin-team-members"],
    queryFn: async () => {
      const { data: roleRows, error: rolesError } = await supabase.from("user_roles").select("user_id,role").in("role", ["admin", "moderator", "editor"] as any);
      if (rolesError || !roleRows?.length) return [];
      const userIds = [...new Set(roleRows.map((row) => row.user_id))];
      const { data: profileRows, error: profilesError } = await supabase.from("profiles").select("user_id,display_name,avatar_url,is_verified").in("user_id", userIds);
      if (profilesError) return [];
      return userIds.map((userId) => ({ ...profileRows?.find((profile) => profile.user_id === userId), user_id: userId, roles: roleRows.filter((role) => role.user_id === userId).map((role) => role.role) }));
    },
  });

  const stats = [
    { label: "মোট পোস্ট", value: postCount ?? 0, icon: FileText, color: "text-primary" },
    { label: "মিডিয়া ফাইল", value: mediaCount ?? 0, icon: Image, color: "text-accent-foreground" },
    { label: "সাম্প্রতিক ৫ পোস্টের ভিউ", value: recentPosts?.reduce((s, p) => s + (p.views || 0), 0) ?? 0, icon: Eye, color: "text-emerald-600" },
    { label: "সাম্প্রতিক ৫ পোস্টের লাইক", value: recentPosts?.reduce((s, p) => s + (p.likes || 0), 0) ?? 0, icon: Heart, color: "text-rose-500" },
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">ড্যাশবোর্ড</h2>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <stat.icon className={`h-8 w-8 ${stat.color}`} />
              <div>
              <p className="text-2xl font-bold">{stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">সাম্প্রতিক পোস্ট</CardTitle>
        </CardHeader>
        <CardContent>
          {recentPosts && recentPosts.length > 0 ? (
            <div className="space-y-3">
              {recentPosts.map((post) => (
                <div key={post.id} className="flex items-center justify-between border-b border-border pb-2 last:border-0">
                  <div>
                    <p className="text-sm font-medium">{post.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(post.created_at).toLocaleDateString("bn-BD")}
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    post.status === "published" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                  }`}>
                    {post.status === "published" ? "প্রকাশিত" : "ড্রাফট"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">কোনো পোস্ট নেই। নতুন পোস্ট তৈরি করুন!</p>
          )}
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h3 className="text-base font-semibold">টিম অ্যাকসেস</h3>
          <span className="text-xs text-muted-foreground">{teamMembers.length} জন</span>
        </div>
        {teamMembers.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {teamMembers.map((member) => (
                  <div key={member.user_id} className="flex items-center gap-3 border border-border bg-card px-3 py-3">
                {member.avatar_url ? <img src={member.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover" /> : <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">{member.display_name?.charAt(0) || "A"}</div>}
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 truncate text-sm font-medium">{member.display_name || "নাম নেই"}{member.is_verified && <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" />}</p>
                  <p className="truncate text-xs text-muted-foreground">{member.roles.map((role) => role === "admin" ? "অ্যাডমিন" : role === "moderator" ? "মডারেটর" : "এডিটর").join(" · ")}</p>
                </div>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-muted-foreground">এখনও কোনো প্রশাসনিক সদস্য নেই।</p>}
      </section>
    </div>
  );
};

export default AdminDashboard;
