using UnityEngine;

public class HumanPlayer : PlayerBase
{
    public static HumanPlayer Current;
    float chargeTime;

    protected override void Awake()
    {
        base.Awake();
        Current = this;
    }

    protected override void FixedUpdate()
    {
        base.FixedUpdate();
        float h = Input.GetAxisRaw("Horizontal");
        float v = Input.GetAxisRaw("Vertical");
        Vector3 fwd = Camera.main != null ? Vector3.ProjectOnPlane(Camera.main.transform.forward, Vector3.up).normalized : Vector3.forward;
        Vector3 right = Camera.main != null ? Vector3.ProjectOnPlane(Camera.main.transform.right, Vector3.up).normalized : Vector3.right;
        Vector3 dir = (fwd * v + right * h);
        MoveTowards(dir, Input.GetKey(KeyCode.LeftShift));
    }

    void Update()
    {
        if (Input.GetKeyDown(KeyCode.E)) TryPickup();

        if (HasBall)
        {
            if (Input.GetMouseButton(0))
            {
                chargeTime += Time.deltaTime;
            }
            if (Input.GetMouseButtonUp(0))
            {
                float power = Mathf.Clamp01(chargeTime / 0.6f);
                chargeTime = 0;
                Vector3 aim = targetHoop != null ? targetHoop.rimCenter : transform.position + transform.forward * 4f;
                TryShoot(aim, power);
            }
            if (Input.GetMouseButtonDown(1))
            {
                var mate = team.NearestTo(transform.position + transform.forward * 4f, this);
                if (mate != null) TryPass(mate);
            }
        }
        else
        {
            chargeTime = 0;
        }

        if (Input.GetKeyDown(KeyCode.Space)) Jump();

        if (Input.GetKeyDown(KeyCode.Tab))
        {
            var nearest = team.NearestTo(Ball != null ? Ball.transform.position : transform.position, this);
            if (nearest != null) GameManager.I?.SwitchControl(this, nearest);
        }
    }
}
