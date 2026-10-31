import { db, must } from "@agencyos/db";

export async function pipelineSummary() {
  const pipeline = must(await db().from("pipeline_summary").select("*"));
  const runs = must(await db().from("search_runs").select("niche,city,country,results_count,new_count,created_at").order("created_at", { ascending: false }).limit(5));
  return { pipeline, recent_searches: runs };
}
