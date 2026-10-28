# Tencent Meeting API research for Meeting Intelligence

**Research date:** 2026-10-14  
**Source policy:** Tencent official documentation only (cloud.tencent.com / Tencent Meeting API domain). No credentials were available or used. No account API calls were made.

## Feasibility at a glance

| Capability | Documented status | Practical condition |
|---|---|---|
| Enterprise app authentication | Supported | Tencent Meeting enterprise self-built app uses AK/SK and per-request signed headers. Requires enterprise credentials and provisioned application/permissions. |
| Upcoming / in-progress meeting list | Supported, scoped | Per-user endpoint. An AK/SK enterprise app can query that enterprise user's valid meetings; OAuth can query meetings created through that OAuth app. At most 20 per call; cursor pagination. |
| Ended meeting list | Supported, scoped | Per-user history endpoint, including meetings the user created or attended; page size max 20, time window max 90 days. |
| Recording list | Supported | Per-user / meeting endpoint with owner or recording-manager restrictions; required operator and time bounds. Account-wide endpoint is AK/SK only, account-admin only, and limited to 10 calls/minute. |
| Transcript contents | Supported | Structured transcript endpoint returns timestamped paragraphs/sentences/words. Requires a finished/generated transcript, permissions, and for newly created self-built apps an STS-Token header. |
| Summary / minutes contents | Supported with feature and plan gates | Smart minutes endpoint returns text or Markdown and TODO text; only when feature/content is generated. The separate smart full-summary endpoint is marked for future removal and should not be used for a new integration. |
| Downloadable recording/transcript/minutes files | Supported conditionally | Detail endpoint returns short-lived download URLs and file types. Some summary/minutes arrays are empty unless the recording allows downloads. Some OAuth account types receive empty download URLs. |
| Actual tenant availability | Unverified | The docs establish API capability, not that a particular tenant has the required plan, application, role grants, recording features, or data. |

“Unsupported” below means the official documentation explicitly says it is unsupported. “Unverified” means documentation does not establish tenant-level availability; no live account test was possible. A runtime/network failure would not establish that an API capability is unsupported.

## Enterprise self-built application authentication

Official guide: [Enterprise self-built app authentication (AK/SK)](https://cloud.tencent.com/document/product/1095/42413), last updated 2026-02-12 18:04:41.

Tencent documents TC3-HMAC-SHA256 authentication. Despite the name, the documented request signature construction is:

1. Build the signature string as  
   `HTTP_METHOD + "\n" + header_string + "\n" + URI_WITH_QUERY + "\n" + BODY`.
2. `header_string` contains `X-TC-Key=<SecretId>&X-TC-Nonce=<nonce>&X-TC-Timestamp=<unix-seconds>`, sorted by header name (this order is shown in the official example).
3. Use HMAC-SHA256 keyed by SecretKey over the UTF-8 signature string.
4. Convert the HMAC bytes to a lowercase hexadecimal string, then Base64-encode the UTF-8 bytes of that hexadecimal string. Send the resulting value in `X-TC-Signature`.

For GET, the body participates as the empty string. The URI in the signature includes the complete query string. Each request needs a fresh positive-integer nonce and current Unix timestamp; timestamps more than five minutes from Tencent server time fail, and nonce/timestamp pairs cannot be replayed within five minutes.

Documented common headers:

- Required: `Content-Type: application/json`, `X-TC-Key` (SecretId), `X-TC-Timestamp`, `X-TC-Nonce`, `X-TC-Signature`, and `AppId` (enterprise ID).
- `SdkId` is required when the application has one.
- `X-TC-Registered: 1` enables the account directory and is documented as necessary for meetings created by the app to appear in users' meeting lists.
- `X-TC-Action` and `X-TC-Region` are optional and only apply to APIs that call them out.
- For newly created self-built applications, Tencent now requires `STS-Token` on the sensitive transcript-details and single-record-details endpoints. The AK/SK guide links STS token generation through a webhook callback. Do not assume an old app can omit STS without checking its app creation date and endpoint-specific requirements.

The self-built application model is internal to one enterprise. Tencent says it cannot request user authorization and cannot be promoted for use by external customers. Credentials are not supplied for this research.

## Meeting lists

### Upcoming and in-progress meetings

Official guide: [Query a user's meetings](https://cloud.tencent.com/document/product/1095/42421), last updated 2024-08-15 14:44:12.

**Endpoint:** `GET https://api.meeting.qq.com/v1/meetings?userid={userid}&instanceid={instanceid}`

**Required query fields:**

- `userid`: enterprise-unique user ID for AK/SK, or the OAuth user's openId.
- `instanceid`: device type. Values include 0 PSTN, 1 PC, 2 Mac, 3 Android, 4 iOS, 5 Web, 6 iPad, 7 Android Pad, 8 mini program, 9 VoIP/SIP, 10 Linux, and several Rooms/controller IDs.

Optional pagination and recurrence fields:

- `pos`: Unix seconds, start-time cursor; default 0 (Beijing midnight). Repeated calls use returned `next_pos` while `remaining` is nonzero.
- `cursory`: last-modified cursor in Unix milliseconds. Tencent recommends using this with `pos`; using only `pos` can miss pages or repeat results.
- `is_show_all_sub_meetings`: 0 (default) or 1.

At most 20 meetings are returned per call. Response includes `meeting_number`, `meeting_info_list`, `next_pos`, `next_cursory`, and `remaining`. Each meeting can include `subject`, `meeting_id`, `meeting_code`, `hosts`, `start_time`, `end_time`, `meeting_type`, `status`, and recurring-meeting data.

**Scope:** The docs state that enterprise-secret users may query valid meetings created by any specified user in their enterprise. OAuth users can query only valid meetings created through that OAuth application. This endpoint is not the history endpoint for ended meetings.

Example from Tencent's documented response shape:

```json
{
  "meeting_number": 1,
  "remaining": 0,
  "meeting_info_list": [
    {
      "meeting_id": "1111111111111111111",
      "meeting_code": "222222222",
      "subject": "tester预定的会议",
      "start_time": "1614308400",
      "end_time": "1614310200",
      "meeting_type": 0,
      "status": "MEETING_STATE_INIT"
    }
  ]
}
```

### Ended meetings

Official guide: [Query a user's ended meetings](https://cloud.tencent.com/document/product/1095/53805), last updated 2025-05-15 15:37:22.

**Endpoint:**  
`GET https://api.meeting.qq.com/v1/history/meetings/{userid}?page_size={page_size}&page={page}&meeting_code={meeting_code}&start_time={start_time}&end_time={end_time}`

**Required:** path `userid`, `page_size`, and `page`. Page size defaults to 20 and has a maximum of 20; page numbering starts at 1. Optional `meeting_code`, `start_time`, and `end_time` use Unix seconds. The start/end interval may not exceed 90 days. If only one time bound is supplied, Tencent infers a 31-day range.

This endpoint returns meetings the specified user created or attended, but only after Tencent considers them ended. A meeting past scheduled end time can remain absent while participants are still present. The example response uses `meeting_info_list` entries with `meeting_id`, `meeting_code`, `subject`, `meeting_type`, `start_time`, and `end_time`.

## Recording lists

### Meeting/user recording list

Official guide: [Query meeting recording list](https://cloud.tencent.com/document/product/1095/51189), last updated 2026-01-29 17:34:01.

**Endpoint:**  
`GET https://api.meeting.qq.com/v1/records?page_size={page_size}&page={page}&meeting_id={meeting_id}&meeting_code={meeting_code}&userid={userid}&start_time={start_time}&end_time={end_time}`

The endpoint's documented full query set and required fields are:

- Required: `operator_id`, `operator_id_type`, `start_time`, `end_time`.
- Optional: `meeting_id`, `meeting_code`, `page_size`, `page`, `media_set_type`, `query_record_type`.
- Time range may not exceed 31 days. Page size defaults to 10 and maxes at 20.
- `operator_id_type`: 1 userid, 2 openid, 3 rooms_id.
- Only the meeting creator, enterprise super administrator, or user with enterprise recording-management rights can call it. When both meeting ID and meeting code are omitted, it queries the operator's recordings.

Response: `total_count`, `current_size`, `current_page`, `total_page`, and `record_meetings[]`. Each record meeting includes `meeting_record_id`, `meeting_id`, `meeting_code`, `host_user_id`, `media_start_time` (milliseconds), `subject`, `state`, `record_type`, and `record_files[]`. File objects include `record_file_id`, start/end time, byte size, sharing state, access controls, password, expiry, and download permission.

Representative documented response:

```json
{
  "total_count": 1,
  "current_size": 10,
  "current_page": 1,
  "total_page": 1,
  "record_meetings": [{
    "meeting_record_id": "1318080818611111111",
    "meeting_id": "1360800130111111111",
    "meeting_code": "423111111",
    "host_user_id": "testUser",
    "media_start_time": 1603089930093,
    "subject": "testUser的快速会议",
    "state": 3,
    "record_type": 0,
    "record_files": [{
      "record_file_id": "1318080818611111111",
      "record_start_time": 1603089930577,
      "record_end_time": 1603089967213,
      "record_size": 604081,
      "sharing_state": 1,
      "allow_download": false
    }]
  }]
}
```

### Account-wide recording list

Official guide: [Get account-level meeting recording list](https://cloud.tencent.com/document/product/1095/53224), last updated 2026-01-23 15:13:31.

**Endpoint:**  
`GET https://api.meeting.qq.com/v1/corp/records?start_time={start_time}&end_time={end_time}&page_size={page_size}&page={page}&operator_id={operator_id}&operator_id_type={operator_id_type}`

Required: `start_time`, `end_time`, `operator_id`, `operator_id_type`. Time window maximum 31 days. Page size defaults to 10, max 20. This endpoint is for account administrators, requires recording view/edit permission, has a 10 requests/minute limit, and **explicitly does not support OAuth 2.0**.

The response includes the same pagination envelope and `record_meetings[]`, with `record_files[]`. When sharing is enabled, account-level results can include `view_address`; a `download_address` is returned only when download is permitted and sharing is enabled, and expires after 6 hours. See the detail endpoint below for the more generally applicable short-lived address API.

## Transcript and summary retrieval

### Single recording detail: file links plus downloadable transcript/minutes artifacts

Official guide: [Query single recording details (file, transcript, minutes)](https://cloud.tencent.com/document/product/1095/51180), last updated 2026-08-06 19:16:00.

**Endpoint:**  
`GET https://api.meeting.qq.com/v1/addresses/{record_file_id}?operator_id={operator_id}&operator_id_type={operator_id_type}`

Required path/query fields: `record_file_id`, `operator_id`, `operator_id_type`. Operator type values: 1 userid, 2 openid, 3 rooms_id. Self-built app requires STS-Token for newly created apps. OAuth does not require STS-Token. AK/SK can access a single recording under the enterprise; OAuth can access only the relevant OAuth application's enterprise recording. Caller also needs recording view/manage rights and operator role recording-view permission.

Documented output fields include:

- `view_address`, `download_address` (recording URL expires after 5 minutes), `download_address_file_type`, plus audio URL and format where available.
- `meeting_summary[]`: transcript file links, file types such as txt/pdf/docx.
- `ai_meeting_transcripts[]`: optimized transcript file links and file types.
- `ai_minutes[]`, `ai_topic_minutes[]`, `ai_speaker_minutes[]`, `ai_ds_minutes[]`: downloadable minutes in formats such as txt/pdf/docx/htm.
- Each listed artifact has a `download_address` and `file_type`; these links expire after 5 minutes. For OAuth, personal free accounts and free enterprises created through WeCom receive empty download URL values. The minutes arrays are empty if recording download is not enabled. Tencent's example also describes several arrays as empty for those OAuth account types.

This is direct documentation of downloadable attachments/URLs, not a guarantee that every recording has every artifact. There are explicit feature, sharing/download, plan, and processing gates. The app would need to retrieve the URLs promptly and handle expiry.

### Transcript as structured text

Official guide: [Query recording transcript details](https://cloud.tencent.com/document/product/1095/65111), last updated 2026-08-06 19:16:00.

**Endpoint:**  
`GET https://api.meeting.qq.com/v1/records/transcripts/details`

Required query fields: `record_file_id`, `operator_id`, `operator_id_type`. Optional `meeting_id`, `pid`, `limit`, `transcripts_type` (0 original, 1 AI-optimized). If `pid` or `limit` truncates results, `more=true` signals continuation. The response contains `minutes.paragraphs[]`, each with paragraph IDs and millisecond start/end times, speaker info, sentences, and word-level text/timestamps; it can include keywords and audio-speaker-detection status.

This returns transcript text as structured JSON and supports pagination; it is distinct from downloading a transcript file. Available for OAuth only for authorized commercial, enterprise, and education users. New self-built apps must send STS-Token. The docs mention errors for “transcript not generated,” “no transcript content,” and “content generating,” so a recording alone does not imply transcript availability.

Representative shape from Tencent:

```json
{
  "more": false,
  "minutes": {
    "paragraphs": [{
      "pid": "0",
      "start_time": 4400,
      "end_time": 42950,
      "sentences": [{
        "sid": "0",
        "start_time": 4400,
        "end_time": 9500,
        "words": [{
          "wid": "0",
          "start_time": 4400,
          "end_time": 4640,
          "text": "看"
        }]
      }]
    }]
  }
}
```

### Smart minutes content

Official guide: [Smart minutes](https://cloud.tencent.com/document/product/1095/109458), last updated 2026-09-09 09:26:30.

**Endpoint:**  
`GET https://api.meeting.qq.com/v1/smart/minutes/{record_file_id}?operator_id_type={operator_id_type}&operator_id={operator_id}&minute_type={minute_type}&text_type={text_type}`

Required: `record_file_id`, `operator_id`, `operator_id_type`. Optional: `lang`, `pwd`, `llm` (1 Hunyuan, 2 DeepSeek, 3 Yuanbao minutes/default), `minute_type` (0 smart minutes, 1 by chapter, 2 by topic, 3 by speaker), and `text_type` (1 plain text, 2 Markdown). Tencent says it supports both AK/SK and OAuth; authorized user must be commercial, enterprise, or education. It is unavailable if the smart feature was not enabled or content is still generating.

Response shape:

```json
{
  "meeting_minute": {
    "minute": "## 会议摘要\n\n#### 测试主题\n\n测试内容\n",
    "todo": "## 会议待办\n\n- 测试"
  }
}
```

With `llm=3`, TODO content is included in `minute`, and `todo` is not separately returned. The endpoint returns text, not a file attachment.

### Legacy smart full summary

Official guide: [Smart full summary](https://cloud.tencent.com/document/product/1095/105661), last updated 2026-08-27 17:00:30.

The documented endpoint is `GET https://api.meeting.qq.com/v1/smart/fullsummary`, with required `operator_id`, `operator_id_type`, and `record_file_id`; it returns `ai_summary` as Base64-encoded content. The current official page explicitly says this endpoint **will be removed** and is not recommended for new integrations. Its page says OAuth 2.0 is supported, with commercial/enterprise/education plan restrictions; do not design around it where the recommended smart-minutes endpoint is available.

## Official source index

- [Enterprise AK/SK authentication](https://cloud.tencent.com/document/product/1095/42413) — updated 2026-02-12.
- [Upcoming/in-progress user meetings](https://cloud.tencent.com/document/product/1095/42421) — updated 2024-08-15.
- [Ended user meetings](https://cloud.tencent.com/document/product/1095/53805) — updated 2025-05-15.
- [Meeting recording list](https://cloud.tencent.com/document/product/1095/51189) — updated 2026-01-29.
- [Account-level recording list](https://cloud.tencent.com/document/product/1095/53224) — updated 2026-01-23.
- [Single recording details and download links](https://cloud.tencent.com/document/product/1095/51180) — updated 2026-08-06.
- [Transcript detail](https://cloud.tencent.com/document/product/1095/65111) — updated 2026-08-06.
- [Smart minutes](https://cloud.tencent.com/document/product/1095/109458) — updated 2026-09-09.
- [Smart full summary, marked for removal](https://cloud.tencent.com/document/product/1095/105661) — updated 2026-08-27.
- [REST API overview and permission matrix](https://cloud.tencent.com/document/product/1095/113415) — updated 2025-03-13.

