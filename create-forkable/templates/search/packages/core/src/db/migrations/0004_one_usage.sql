CREATE TABLE "one_usage" (
	"user_id" text NOT NULL,
	"day" text NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"refused" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "one_usage_user_id_day_pk" PRIMARY KEY("user_id","day")
);
