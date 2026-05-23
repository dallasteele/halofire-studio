using UnityEngine;

public class ProcAudio : MonoBehaviour
{
    public static ProcAudio I;
    AudioClip bounce, shot, pass, swish;

    void Awake()
    {
        I = this;
        bounce = MakeThump(0.18f, 80f);
        shot   = MakeWhoosh(0.22f);
        pass   = MakeThump(0.10f, 220f);
        swish  = MakeSwish(0.45f);
    }

    public void PlayBounce(Vector3 p, float vol) => AudioSource.PlayClipAtPoint(bounce, p, Mathf.Clamp01(vol));
    public void PlayShot(Vector3 p) => AudioSource.PlayClipAtPoint(shot, p, 0.5f);
    public void PlayPass(Vector3 p) => AudioSource.PlayClipAtPoint(pass, p, 0.5f);
    public void PlaySwish(Vector3 p) => AudioSource.PlayClipAtPoint(swish, p, 0.8f);

    static AudioClip MakeThump(float seconds, float freq)
    {
        int sr = 22050;
        int n = (int)(sr * seconds);
        var samples = new float[n];
        for (int i = 0; i < n; i++)
        {
            float t = i / (float)sr;
            float env = Mathf.Exp(-t * 22f);
            float w = Mathf.Sin(2f * Mathf.PI * freq * t) + 0.3f * Mathf.Sin(2f * Mathf.PI * freq * 2.1f * t);
            samples[i] = env * w * 0.8f;
        }
        var c = AudioClip.Create("thump", n, 1, sr, false);
        c.SetData(samples, 0);
        return c;
    }

    static AudioClip MakeWhoosh(float seconds)
    {
        int sr = 22050;
        int n = (int)(sr * seconds);
        var samples = new float[n];
        var rng = new System.Random(1);
        float lp = 0;
        for (int i = 0; i < n; i++)
        {
            float t = i / (float)sr;
            float env = Mathf.Sin(Mathf.PI * Mathf.Clamp01(t / seconds));
            float noise = (float)(rng.NextDouble() * 2 - 1);
            lp = Mathf.Lerp(lp, noise, 0.12f);
            samples[i] = lp * env * 0.4f;
        }
        var c = AudioClip.Create("whoosh", n, 1, sr, false);
        c.SetData(samples, 0);
        return c;
    }

    static AudioClip MakeSwish(float seconds)
    {
        int sr = 22050;
        int n = (int)(sr * seconds);
        var samples = new float[n];
        var rng = new System.Random(2);
        float lp = 0, hp = 0, prev = 0;
        for (int i = 0; i < n; i++)
        {
            float t = i / (float)sr;
            float env = Mathf.Pow(Mathf.Sin(Mathf.PI * Mathf.Clamp01(t / seconds)), 1.5f);
            float noise = (float)(rng.NextDouble() * 2 - 1);
            lp = Mathf.Lerp(lp, noise, 0.35f);
            hp = lp - prev;
            prev = lp;
            samples[i] = hp * env * 0.6f;
        }
        var c = AudioClip.Create("swish", n, 1, sr, false);
        c.SetData(samples, 0);
        return c;
    }
}
