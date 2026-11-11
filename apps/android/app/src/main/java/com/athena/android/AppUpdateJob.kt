package com.athena.android

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit

/** Let Android check for a signed release when the app is away and the network is available. */
class AppUpdateJob : JobService() {
    companion object {
        private const val JOB_ID = 0x415448
        fun schedule(context: Context) {
            if (BuildConfig.DEBUG) return
            val scheduler = context.getSystemService(JobScheduler::class.java)
            if (scheduler.getPendingJob(JOB_ID) != null) return
            scheduler.schedule(JobInfo.Builder(JOB_ID, ComponentName(context, AppUpdateJob::class.java))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(TimeUnit.HOURS.toMillis(12))
                .setPersisted(true)
                .build())
        }
    }

    private val worker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private var running: JobParameters? = null
    private var check: Future<*>? = null

    override fun onStartJob(params: JobParameters): Boolean {
        val notifications = NativeNotifications(this)
        if (notifications.permission() != "granted") return false
        val prefs = getSharedPreferences("athena", MODE_PRIVATE)
        val channel = prefs.getString("updateChannel", "stable") ?: "stable"
        val network = if (Build.VERSION.SDK_INT >= 28) params.network else null
        running = params
        check = worker.submit {
            val update = runCatching { AppUpdates.findUpdate(channel, network) }.getOrNull()
            main.post {
                if (running === params) {
                    running = null
                    check = null
                    if (update != null) notifications.showUpdate(update.version, update.code, channel)
                    jobFinished(params, false)
                }
            }
        }
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean {
        running = null
        check?.cancel(true)
        check = null
        return true
    }

    override fun onDestroy() {
        running = null
        worker.shutdownNow()
        super.onDestroy()
    }
}
