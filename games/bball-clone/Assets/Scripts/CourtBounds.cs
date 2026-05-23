using UnityEngine;

public class CourtBounds : MonoBehaviour
{
    void OnTriggerExit(Collider other)
    {
        var ball = other.GetComponent<BallController>();
        if (ball == null) return;
        GameManager.I?.OnBallOutOfBounds(ball);
    }
}
