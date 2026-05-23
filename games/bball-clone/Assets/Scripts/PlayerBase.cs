using UnityEngine;

[RequireComponent(typeof(Rigidbody), typeof(CapsuleCollider))]
public class PlayerBase : MonoBehaviour
{
    public Team team;
    public Hoop targetHoop;
    public Hoop ownHoop;
    public Transform HandAnchor;
    public float maxSpeed = 6.5f;
    public float sprintMul = 1.35f;
    public float accel = 30f;
    public float jumpImpulse = 5.5f;
    public float reach = 0.9f;

    protected Rigidbody rb;
    protected bool grounded;
    protected float shotCooldown;
    public bool HasBall => Ball.Holder == this;
    public BallController Ball => GameManager.I != null ? GameManager.I.Ball : null;

    public Vector3 Position => transform.position;

    protected virtual void Awake()
    {
        rb = GetComponent<Rigidbody>();
        rb.constraints = RigidbodyConstraints.FreezeRotationX | RigidbodyConstraints.FreezeRotationZ;
        rb.interpolation = RigidbodyInterpolation.Interpolate;
    }

    protected virtual void FixedUpdate()
    {
        grounded = Physics.Raycast(transform.position + Vector3.up * 0.1f, Vector3.down, 0.25f);
        if (shotCooldown > 0) shotCooldown -= Time.fixedDeltaTime;
    }

    protected void MoveTowards(Vector3 worldDir, bool sprint)
    {
        Vector3 d = Vector3.ProjectOnPlane(worldDir, Vector3.up);
        if (d.sqrMagnitude > 1f) d.Normalize();
        float target = maxSpeed * (sprint ? sprintMul : 1f);
        Vector3 v = rb.velocity;
        Vector3 desired = d * target;
        Vector3 diff = new Vector3(desired.x - v.x, 0, desired.z - v.z);
        rb.AddForce(diff * accel, ForceMode.Acceleration);
        if (d.sqrMagnitude > 0.01f)
        {
            Quaternion q = Quaternion.LookRotation(d);
            transform.rotation = Quaternion.RotateTowards(transform.rotation, q, 540f * Time.fixedDeltaTime);
        }
    }

    public void TryPickup()
    {
        var ball = Ball;
        if (ball == null || ball.Holder != null) return;
        if (Vector3.Distance(transform.position, ball.transform.position) > reach + BallController.Radius) return;
        ball.AttachTo(this);
    }

    public bool TryShoot(Vector3 targetPoint, float power = 1f)
    {
        if (!HasBall || shotCooldown > 0) return false;
        Vector3 start = HandAnchor.position;
        Vector3 to = targetPoint - start;
        float gravity = Mathf.Abs(Physics.gravity.y);
        float horiz = new Vector2(to.x, to.z).magnitude;
        float vert = to.y;
        float angle = Mathf.Lerp(48f, 56f, Mathf.Clamp01(horiz / 8f)) * Mathf.Deg2Rad;
        float denom = 2f * Mathf.Cos(angle) * Mathf.Cos(angle) * (horiz * Mathf.Tan(angle) - vert);
        if (denom <= 0) return false;
        float speed = Mathf.Sqrt(gravity * horiz * horiz / denom);
        speed *= Mathf.Lerp(1.04f, 0.96f, Mathf.Clamp01(power));
        Vector3 dirH = new Vector3(to.x, 0, to.z).normalized;
        Vector3 v = dirH * Mathf.Cos(angle) * speed + Vector3.up * Mathf.Sin(angle) * speed;
        float skill = Random.Range(0.92f, 1.06f);
        v *= skill;
        v += new Vector3(Random.Range(-0.3f, 0.3f), 0, Random.Range(-0.3f, 0.3f));
        Ball.Release(v, Random.insideUnitSphere * 6f);
        shotCooldown = 0.6f;
        ProcAudio.I?.PlayShot(transform.position);
        GameManager.I?.OnShotAttempted(this, transform.position);
        return true;
    }

    public bool TryPass(PlayerBase target)
    {
        if (!HasBall || target == null || target == this) return false;
        Vector3 start = HandAnchor.position;
        Vector3 lead = target.Position + Vector3.up * 1.3f + Vector3.ProjectOnPlane(target.rb.velocity, Vector3.up) * 0.35f;
        Vector3 to = lead - start;
        float t = Mathf.Clamp(to.magnitude / 14f, 0.3f, 0.9f);
        Vector3 v = to / t;
        v.y += 0.5f * Mathf.Abs(Physics.gravity.y) * t;
        Ball.Release(v, Vector3.zero);
        shotCooldown = 0.2f;
        ProcAudio.I?.PlayPass(transform.position);
        return true;
    }

    public void Jump()
    {
        if (!grounded) return;
        rb.AddForce(Vector3.up * jumpImpulse, ForceMode.VelocityChange);
    }
}
