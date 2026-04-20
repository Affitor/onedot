CREATE TABLE "od_clicks" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_id" text NOT NULL,
	"program_id" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"referer" text,
	"landing_page" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"converted" boolean DEFAULT false NOT NULL,
	"converted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "od_commissions" (
	"id" text PRIMARY KEY NOT NULL,
	"sale_id" text NOT NULL,
	"partner_id" text NOT NULL,
	"program_id" text NOT NULL,
	"sale_amount_cents" integer NOT NULL,
	"commission_percent" numeric(8, 4) NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"hold_until" timestamp,
	"approved_at" timestamp,
	"rejected_at" timestamp,
	"paid_at" timestamp,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "od_partners" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text,
	"email" text,
	"program_id" text NOT NULL,
	"balance_cents" integer DEFAULT 0 NOT NULL,
	"paid_cents" integer DEFAULT 0 NOT NULL,
	"lifetime_earnings_cents" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "od_partners_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "od_programs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"commission_type" text DEFAULT 'cps_recurring' NOT NULL,
	"commission_percent" numeric(8, 4),
	"commission_fixed" integer,
	"cookie_days" integer DEFAULT 30 NOT NULL,
	"hold_days" integer DEFAULT 14 NOT NULL,
	"auto_approve" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "od_programs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "od_referrals" (
	"id" text PRIMARY KEY NOT NULL,
	"click_id" text,
	"partner_id" text NOT NULL,
	"program_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "od_sales" (
	"id" text PRIMARY KEY NOT NULL,
	"referral_id" text NOT NULL,
	"partner_id" text NOT NULL,
	"program_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"external_id" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "od_sales_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "od_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_id" text NOT NULL,
	"type" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"commission_id" text,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "od_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"delivered_at" timestamp,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "od_clicks" ADD CONSTRAINT "od_clicks_partner_id_od_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."od_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "od_clicks" ADD CONSTRAINT "od_clicks_program_id_od_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."od_programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "od_commissions" ADD CONSTRAINT "od_commissions_sale_id_od_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."od_sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "od_commissions" ADD CONSTRAINT "od_commissions_partner_id_od_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."od_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "od_commissions" ADD CONSTRAINT "od_commissions_program_id_od_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."od_programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "od_partners" ADD CONSTRAINT "od_partners_program_id_od_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."od_programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "od_referrals" ADD CONSTRAINT "od_referrals_click_id_od_clicks_id_fk" FOREIGN KEY ("click_id") REFERENCES "public"."od_clicks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "od_referrals" ADD CONSTRAINT "od_referrals_partner_id_od_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."od_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "od_referrals" ADD CONSTRAINT "od_referrals_program_id_od_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."od_programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "od_sales" ADD CONSTRAINT "od_sales_referral_id_od_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."od_referrals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "od_sales" ADD CONSTRAINT "od_sales_partner_id_od_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."od_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "od_sales" ADD CONSTRAINT "od_sales_program_id_od_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."od_programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "od_transactions" ADD CONSTRAINT "od_transactions_partner_id_od_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."od_partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "od_transactions" ADD CONSTRAINT "od_transactions_commission_id_od_commissions_id_fk" FOREIGN KEY ("commission_id") REFERENCES "public"."od_commissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "od_clicks_partner_idx" ON "od_clicks" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "od_clicks_created_idx" ON "od_clicks" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "od_commissions_partner_idx" ON "od_commissions" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "od_commissions_status_idx" ON "od_commissions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "od_commissions_hold_idx" ON "od_commissions" USING btree ("hold_until");--> statement-breakpoint
CREATE INDEX "od_partners_program_idx" ON "od_partners" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "od_partners_email_idx" ON "od_partners" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "od_referrals_customer_program_idx" ON "od_referrals" USING btree ("customer_id","program_id");--> statement-breakpoint
CREATE INDEX "od_referrals_partner_idx" ON "od_referrals" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "od_sales_partner_idx" ON "od_sales" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "od_sales_customer_idx" ON "od_sales" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "od_sales_created_idx" ON "od_sales" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "od_transactions_partner_idx" ON "od_transactions" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "od_transactions_type_idx" ON "od_transactions" USING btree ("type");--> statement-breakpoint
CREATE INDEX "od_webhook_events_type_idx" ON "od_webhook_events" USING btree ("type");