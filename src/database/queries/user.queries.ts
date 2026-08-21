import bcrypt from "bcrypt";
import {sql} from "kysely";
import type {ModelType} from "../../model/db";
import {DatabaseManager} from "..";

export class UserQueries {
  static async fetchBy(identifier: string | number, type: "username" | "handle" | "id" | "mail") {
    const db = DatabaseManager.getInstance();

    return db.selectFrom("user").selectAll().where(type, "=", identifier).executeTakeFirst();
  }

  static async fetchAI(type: ModelType, version: string) {
    const db = DatabaseManager.getInstance();
    return db
      .selectFrom("model")
      .selectAll()
      .where("type", "=", type)
      .where("version", "=", version)
      .executeTakeFirst();
  }

  static async getUserRole(user_id: number) {
    const db = DatabaseManager.getInstance();
    const result = await db
      .selectFrom("user_role")
      .innerJoin("role", "user_role.role_id", "role.id")
      .select("role.name")
      .where("user_id", "=", user_id)
      .executeTakeFirst();
    return result?.name;
  }

  static async fetchHash(username: string) {
    const db = DatabaseManager.getInstance();
    return db.selectFrom("user").select(["password_hash"]).where("username", "=", username).executeTakeFirst();
  }

  static async insert(username: string, mail: string, password_hash: string) {
    const db = DatabaseManager.getInstance();
    return db.insertInto("user").values({username, password_hash, mail}).returningAll().executeTakeFirst();
  }

  private static getListenedAll(user_id: number, startDate?: Date, endDate?: Date) {
    const db = DatabaseManager.getInstance();
    let query = db
      .selectFrom("listened")
      .where("user_id", "=", user_id)
      .innerJoin("video as v", "listened.video_id", "v.id")
      .innerJoin("video_metadata", join =>
        join.onRef("v.id", "=", "video_metadata.video_id").onRef("default_language", "=", "video_metadata.language"),
      )
      .innerJoin("channel as c", "v.channel_id", "c.id")
      .leftJoin("genre_prediction as gp", "v.id", "gp.video_id");

    if (endDate) {
      query = query.where("listened_at", "<=", endDate);
    }

    if (startDate) {
      query = query.where("listened_at", ">=", startDate);
    } else {
      query = query.where("listened_at", ">", sql<Date>`NOW() - INTERVAL '7 day'`);
    }
    return query;
  }

  static async getTopMusic(user_id: number, startDate?: Date, endDate?: Date, limit?: number, offset?: number) {
    const db = DatabaseManager.getInstance();
    let query = UserQueries.getListenedAll(user_id, startDate, endDate);
    // correlated per video: aggregating ner_prediction as a joined subquery scans the whole table per row
    const nerResult = sql`(
      select jsonb_object_agg(entity_type, entity_values)
      from (
        select entity_type, jsonb_agg(entity_value) as entity_values
        from ner_prediction
        where video_id = "v"."id"
        group by entity_type
      ) as inner_agg
    )`;

    query = query
      .groupBy(["v.id", "v.yt_id", "video_metadata.title", "c.name", "c.yt_id", "c.profile_picture_uri"])
      .select(eb => [
        eb.ref("v.yt_id").as("video_id"),
        eb.ref("video_metadata.title").as("video_title"),
        eb.ref("c.name").as("artist_name"),
        eb.ref("c.yt_id").as("artist_id"),
        eb.ref("c.profile_picture_uri").as("artist_profile_picture_url"),
        nerResult.as("NER"),
        db.fn.count<number>(sql.ref("listened.listened_at")).distinct().as("listen_count"),
      ])
      .orderBy("listen_count", "desc")
      .limit(limit ?? 10)
      .offset(offset ?? 0);

    type TopMusicRow = {
      video_id: string;
      video_title: string;
      artist_name: string;
      artist_id: string;
      listen_count: number;
      artist_profile_picture_url: string | null;
      NER: Record<string, string[] | null> | null;
    };

    return query.execute() as Promise<TopMusicRow[]>;
  }

  static async getTopArtists(user_id: number, startDate?: Date, endDate?: Date, limit?: number, offset?: number) {
    const db = DatabaseManager.getInstance();
    let query = UserQueries.getListenedAll(user_id, startDate, endDate);
    query = query
      .groupBy(["c.yt_id", "c.name", "c.profile_picture_uri"])
      .select(eb => [
        eb.ref("c.yt_id").as("artist_id"),
        eb.ref("c.name").as("artist_name"),
        eb.ref("c.profile_picture_uri").as("artist_profile_picture_url"),
        db.fn.count<number>(sql.ref("listened.listened_at")).distinct().as("listen_count"),
      ])
      .orderBy("listen_count", "desc")
      .limit(limit ?? 10)
      .offset(offset ?? 0);

    return query.execute();
  }

  static async getTopGenres(user_id: number, startDate?: Date, endDate?: Date, limit?: number, offset?: number) {
    const db = DatabaseManager.getInstance();
    let query = UserQueries.getListenedAll(user_id, startDate, endDate);
    const genreEntries = sql<{
      key: string;
      value: string;
    }>`jsonb_each_text(COALESCE(gp.genres_logits, (SELECT jsonb_object_agg(g, 1) FROM unnest(gp.genres) AS g)))`.as(
      "genre",
    );

    query = query
      .innerJoin(genreEntries, join => join.onTrue())
      .select(() => [
        sql<string>`genre.key`.as("genre_name"),
        sql<number>`SUM((genre.value)::float)`.as("listen_count"),
      ])
      .groupBy("genre.key")
      .orderBy("listen_count", "desc")
      .limit(limit ?? 10)
      .offset(offset ?? 0);
    return query.execute();
  }

  static async getUserHistory(user_id: number, filters: Partial<{limit: number; offset: number}> = {}) {
    const db = DatabaseManager.getInstance();
    return db
      .selectFrom("listened")
      .innerJoin("video as v", "listened.video_id", "v.id")
      .innerJoin("video_metadata", join =>
        join.onRef("v.id", "=", "video_metadata.video_id").onRef("default_language", "=", "video_metadata.language"),
      )
      .innerJoin("channel as c", "v.channel_id", "c.id")
      .leftJoin(
        db
          .selectFrom(
            db
              .selectFrom("ner_prediction")
              .select(["video_id", "entity_type", sql`jsonb_agg(entity_value)`.as("entity_values")])
              .groupBy(["video_id", "entity_type"])
              .as("inner_agg"),
          )
          .select(["video_id", sql`jsonb_object_agg(entity_type, entity_values)`.as("ner_result")])
          .groupBy("video_id")
          .as("ner"),
        "listened.video_id",
        "ner.video_id",
      )
      .where("user_id", "=", user_id)
      .orderBy("listened.listened_at", "desc")
      .select(eb => [
        eb.ref("v.yt_id").as("yt_id"),
        eb.ref("video_metadata.title").as("video_title"),
        eb.ref("listened.listened_at").as("listened_at"),
        eb.ref("c.name").as("artist_name"),
        eb.ref("ner_result").as("NER"),
      ])
      .limit(filters.limit ?? 100)
      .offset(filters.offset ?? 0)
      .execute();
  }

  static async getUserTotalSeconds(user_id: number, filters?: Partial<{startDate: Date; endDate: Date}>) {
    const db = DatabaseManager.getInstance();
    let query = db
      .selectFrom("listened")
      .where("user_id", "=", user_id)
      .innerJoin("video as v", "listened.video_id", "v.id")
      .select(db.fn.sum<number>(sql`v.duration`).as("total_seconds"));

    if (filters?.startDate) {
      query = query.where("listened.listened_at", ">=", filters.startDate);
    }

    if (filters?.endDate) {
      query = query.where("listened.listened_at", "<=", filters.endDate);
    }

    const resultRow = await query.executeTakeFirst();

    return resultRow?.total_seconds ?? 0;
  }

  static async getUserListenSegments(user_id: number, filters?: Partial<{startDate: Date; endDate: Date}>) {
    const db = DatabaseManager.getInstance();
    let query = db
      .selectFrom("listened")
      .innerJoin("video", "listened.video_id", "video.id")
      .where("listened.user_id", "=", user_id)
      .groupBy(sql`DATE_TRUNC('day', listened.listened_at)`)
      .select(eb => [
        sql<Date>`DATE_TRUNC('day', listened.listened_at)`.as("day"),
        eb.fn.sum<number>("video.duration").as("total_seconds"),
      ])
      .orderBy("day", "asc");

    if (filters?.startDate) {
      query = query.where("listened.listened_at", ">=", filters.startDate);
    }

    if (filters?.endDate) {
      query = query.where("listened.listened_at", "<=", filters.endDate);
    }

    return query.execute();
  }

  static async getTotalListenedHours() {
    const db = DatabaseManager.getInstance();
    const result = await db
      .selectFrom("listened")
      .innerJoin("video", "listened.video_id", "video.id")
      .select(db.fn.sum<number>("video.duration").as("total_seconds"))
      .executeTakeFirst();

    const total_seconds = result?.total_seconds ?? 0;
    return total_seconds / 3600;
  }

  static async updateUserInfo(
    user_id: number,
    updates: Partial<{
      email: string;
      displayName: string;
      handle: string;
      currentPassword: string;
      newPassword: string;
    }>,
  ) {
    const db = DatabaseManager.getInstance();
    const updateData: Partial<{mail: string; username: string; handle: string; password_hash: string}> = {};

    if (updates.email) {
      updateData.mail = updates.email;
    }
    if (updates.displayName) {
      updateData.username = updates.displayName;
    }
    if (updates.handle) {
      updateData.handle = updates.handle;
    }
    if (updates.newPassword) {
      updateData.password_hash = bcrypt.hashSync(updates.newPassword, 10);
    }

    if (Object.keys(updateData).length > 0) {
      await db.updateTable("user").set(updateData).where("id", "=", user_id).execute();
    }
  }

  static async deleteUser(user_id: number) {
    const db = DatabaseManager.getInstance();
    await db.deleteFrom("user").where("id", "=", user_id).execute();
  }
}
