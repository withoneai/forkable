CREATE TABLE "rerank_scores" (
	"user_id" text NOT NULL,
	"query" text NOT NULL,
	"item_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"score" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rerank_scores_user_id_query_item_id_pk" PRIMARY KEY("user_id","query","item_id")
);
--> statement-breakpoint
CREATE INDEX "rerank_scores_item_idx" ON "rerank_scores" USING btree ("item_id");