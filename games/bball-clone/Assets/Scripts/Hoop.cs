using UnityEngine;

public class Hoop : MonoBehaviour
{
    public int teamIndex;
    public Vector3 rimCenter;
    public Vector3 facing;
}

public class ScoreTrigger : MonoBehaviour
{
    public Hoop hoop;
    float lastScoreTime = -10f;

    void OnTriggerEnter(Collider other)
    {
        if (Time.time - lastScoreTime < 1.5f) return;
        var ball = other.GetComponent<BallController>();
        if (ball == null) return;
        var rb = ball.Rb;
        if (rb.velocity.y > 0.2f) return;
        lastScoreTime = Time.time;
        GameManager.I?.OnScore(hoop, ball);
    }
}
